import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

function minutesBetween(start: unknown, end: unknown) {
  const from = new Date(String(start))
  const to = new Date(String(end))
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) return 0
  return Math.round((to.getTime() - from.getTime()) / 60000)
}

function timeOf(value: unknown) {
  if (!value) return '–'
  const date = new Date(String(value))
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date)
    : '–'
}

function hours(minutes: number) {
  return (minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildEmployeeFilter(userIds: string[]) {
  if (!userIds.length) return { clause: '', params: [] as string[] }
  const placeholders = userIds.map((_, index) => '$' + (index + 3)).join(', ')
  return { clause: `
          AND user_id IN (${placeholders})`, params: userIds }
}

function safeText(value: unknown) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim()
}

async function fetchSchedules(request: Request, from: string, to: string) {
  try {
    const url = new URL('/api/schedule-v2', request.url)
    url.searchParams.set('resource', 'entries')
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    const response = await fetch(url, { headers: request.headers, cache: 'no-store' })
    if (!response.ok) return []
    const payload = await response.json().catch(() => ({})) as { entries?: Record<string, unknown>[] }
    return Array.isArray(payload.entries) ? payload.entries : []
  } catch { return [] }
}

function sessionGroups(events: Record<string, unknown>[]) {
  const sorted = [...events].sort((a, b) => String(a.client_occurred_at).localeCompare(String(b.client_occurred_at)))
  const groups: Record<string, unknown>[][] = []
  let current: Record<string, unknown>[] = []
  for (const event of sorted) {
    if (event.action === 'clock-in') {
      if (current.length) groups.push(current)
      current = [event]
    } else if (event.action === 'clock-out') {
      if (!current.length) current = [event]
      else current.push(event)
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)
  return groups
}

function buildRow(
  userId: string,
  date: string,
  shift: Record<string, unknown> | undefined,
  items: Record<string, unknown>[],
  rowId: string,
) {
  const ordered = [...items].sort((a, b) => String(a.client_occurred_at).localeCompare(String(b.client_occurred_at)))
  const start = ordered.find((item) => item.action === 'clock-in')
  const end = [...ordered].reverse().find((item) => item.action === 'clock-out')
  const pause = Math.max(0, Number(shift?.pauseMinutes || 0))
  const gross = start && end ? minutesBetween(start.client_occurred_at, end.client_occurred_at) : 0
  return {
    rowId,
    userId,
    scheduleId: safeText(shift?.id || start?.schedule_id || end?.schedule_id || ''),
    employeeName: safeText(shift?.employeeName || userId),
    date,
    month: date.slice(0, 7),
    plannedStart: safeText(shift?.start || '–'),
    plannedEnd: safeText(shift?.end || '–'),
    actualStart: timeOf(start?.client_occurred_at),
    actualEnd: timeOf(end?.client_occurred_at),
    pauseMinutes: pause,
    netMinutes: Math.max(0, gross - pause),
    location: safeText(shift?.location || start?.object_id || end?.object_id || '–'),
    warning: ordered.some((item) => item.location_status !== 'inside' || item.offline_captured),
  }
}

export function groupReportRows(events: Record<string, unknown>[], schedules: Record<string, unknown>[]) {
  const rows: ReturnType<typeof buildRow>[] = []
  const scheduleById = new Map<string, Record<string, unknown>>()
  const consumedSchedules = new Set<string>()
  const eventsBySchedule = new Map<string, Record<string, unknown>[]>()
  const unassignedByDay = new Map<string, Record<string, unknown>[]>()

  for (const shift of schedules) {
    const id = safeText(shift.id)
    if (id) scheduleById.set(id, shift)
  }
  for (const event of events) {
    const scheduleId = safeText(event.schedule_id)
    if (scheduleId) {
      if (!eventsBySchedule.has(scheduleId)) eventsBySchedule.set(scheduleId, [])
      eventsBySchedule.get(scheduleId)!.push(event)
    } else {
      const key = `${safeText(event.user_id)}:${String(event.event_date).slice(0, 10)}`
      if (!unassignedByDay.has(key)) unassignedByDay.set(key, [])
      unassignedByDay.get(key)!.push(event)
    }
  }

  for (const [scheduleId, items] of eventsBySchedule) {
    const shift = scheduleById.get(scheduleId)
    if (shift) consumedSchedules.add(scheduleId)
    const first = items[0] || {}
    const userId = safeText(shift?.employeeUserId || first.user_id)
    const date = safeText(shift?.date || String(first.event_date).slice(0, 10))
    for (const [index, group] of sessionGroups(items).entries()) {
      rows.push(buildRow(userId, date, shift, group, `${scheduleId}:${index}`))
    }
  }

  for (const [key, items] of unassignedByDay) {
    const separator = key.indexOf(':')
    const userId = key.slice(0, separator)
    const date = key.slice(separator + 1)
    const daySchedules = schedules
      .filter((shift) => safeText(shift.employeeUserId) === userId && safeText(shift.date) === date)
      .sort((a, b) => safeText(a.start).localeCompare(safeText(b.start)))
    const groups = sessionGroups(items)
    groups.forEach((group, index) => {
      const shift = daySchedules[index]
      if (shift?.id) consumedSchedules.add(safeText(shift.id))
      rows.push(buildRow(userId, date, shift, group, `unassigned:${key}:${index}`))
    })
  }

  for (const shift of schedules) {
    const id = safeText(shift.id)
    if (id && consumedSchedules.has(id)) continue
    const userId = safeText(shift.employeeUserId)
    const date = safeText(shift.date)
    if (!userId || !date) continue
    rows.push(buildRow(userId, date, shift, [], `planned:${id || `${userId}:${date}:${shift.start}`}`))
  }

  return rows.sort((a, b) => `${a.employeeName}-${a.date}-${a.plannedStart}-${a.actualStart}`.localeCompare(`${b.employeeName}-${b.date}-${b.plannedStart}-${b.actualStart}`))
}

async function buildPdf(request: Request, rows: ReturnType<typeof groupReportRows>, reportType: string, from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: any = null
  try {
    const response = await fetch(new URL('/habun-logo.png', request.url))
    if (response.ok) logo = await pdf.embedPng(await response.arrayBuffer())
  } catch {}
  const company = safeText(Netlify.env.get('PORTAL_COMPANY_NAME') || 'Habun Security')
  const contact = safeText(Netlify.env.get('PORTAL_COMPANY_CONTACT') || '')
  const margin = 38
  const width = 842
  const height = 595
  const rowHeight = 18
  let page: any
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([width, height])
    pageNumber += 1
    y = height - margin
    if (logo) {
      const scaled = logo.scale(0.11)
      page.drawImage(logo, { x: margin, y: y - scaled.height + 8, width: scaled.width, height: scaled.height })
    }
    page.drawText(company, { x: 130, y: y - 4, size: 16, font: bold })
    if (contact) page.drawText(contact, { x: 130, y: y - 20, size: 8, font: regular })
    page.drawText(reportType === 'combined' ? 'Gesamtübersicht Arbeitszeiten' : 'Mitarbeiter-Stundennachweis', { x: margin, y: y - 50, size: 14, font: bold })
    page.drawText(`Zeitraum ${from} bis ${to} · Seite ${pageNumber}`, { x: margin, y: y - 67, size: 9, font: regular })
    y -= 95
    const headers = ['Name', 'Datum', 'Plan', 'Ist', 'Pause', 'Netto', 'Einsatzort', 'Hinweis']
    const xs = [margin, 165, 235, 315, 395, 450, 510, 720]
    headers.forEach((header, index) => page.drawText(header, { x: xs[index], y, size: 8, font: bold }))
    y -= 10
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: rgb(0.45, 0.45, 0.45) })
    y -= 13
  }

  newPage()
  for (const row of rows) {
    if (y < margin + 45) newPage()
    const values = [
      row.employeeName.slice(0, 22), row.date, `${row.plannedStart}-${row.plannedEnd}`,
      `${row.actualStart}-${row.actualEnd}`, `${row.pauseMinutes} Min.`, `${hours(row.netMinutes)} Std.`,
      row.location.slice(0, 30), row.warning ? 'Prüfen' : '',
    ]
    const xs = [margin, 165, 235, 315, 395, 450, 510, 720]
    values.forEach((value, index) => page.drawText(value, { x: xs[index], y, size: 7.5, font: regular }))
    y -= rowHeight
  }

  const monthly = new Map<string, number>()
  const totals = new Map<string, number>()
  let grandTotal = 0
  for (const row of rows) {
    monthly.set(`${row.employeeName}:${row.month}`, (monthly.get(`${row.employeeName}:${row.month}`) || 0) + row.netMinutes)
    totals.set(row.employeeName, (totals.get(row.employeeName) || 0) + row.netMinutes)
    grandTotal += row.netMinutes
  }
  if (y < margin + 80) newPage()
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7 })
  y -= 18
  page.drawText('Monats- und Gesamtsummen', { x: margin, y, size: 10, font: bold })
  for (const [key, total] of monthly) {
    y -= 14
    if (y < margin + 25) newPage()
    const separator = key.lastIndexOf(':')
    page.drawText(`${key.slice(0, separator)} · ${key.slice(separator + 1)}: ${hours(total)} Stunden`, { x: margin, y, size: 8.5, font: regular })
  }
  for (const [name, total] of totals) {
    y -= 15
    if (y < margin + 25) newPage()
    page.drawText(`${name} gesamt: ${hours(total)} Stunden`, { x: margin, y, size: 9, font: bold })
  }
  y -= 17
  if (y < margin + 25) newPage()
  page.drawText(`Gesamtsumme aller ausgewählten Mitarbeiter: ${hours(grandTotal)} Stunden`, { x: margin, y, size: 10, font: bold })
  return pdf.save()
}

export default async function reportsV2(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Mitarbeiter dürfen keine PDF-Berichte herunterladen.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const from = String(body.from || '')
  const to = String(body.to || '')
  const reportType = body.reportType === 'combined' ? 'combined' : 'employee'
  const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : []
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return json({ message: 'Der Zeitraum ist ungültig.' }, 400)
  const url = databaseConnectionString()
  if (!url) return json({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.' }, 503)
  let events: Record<string, unknown>[]
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(url)
    const employeeFilter = buildEmployeeFilter(userIds)
    events = await sql(
      `SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date${employeeFilter.clause}
        ORDER BY user_id, event_date, client_occurred_at`,
      [from, to, ...employeeFilter.params],
    ) as Record<string, unknown>[]
  } catch (error) {
    console.error('Habun legacy report query', error)
    return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.', code: 'REPORT_QUERY_FAILED' }, 500)
  }

  const schedules = await fetchSchedules(request, from, to)
  let rows = groupReportRows(events, schedules)
  if (userIds.length) rows = rows.filter((row) => userIds.includes(row.userId))
  if (!rows.length) return json({ message: 'Für den gewählten Zeitraum sind keine Daten vorhanden.', code: 'NO_DATA' }, 404)

  try {
    const bytes = await buildPdf(request, rows, reportType, from, to)
    const filename = reportType === 'combined' ? `Habun-Gesamtuebersicht-${from}-${to}.pdf` : `Habun-Stundennachweis-${from}-${to}.pdf`
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('Habun legacy report render', error)
    return json({ message: 'Die Berichtsdatei konnte nicht erzeugt werden.', code: 'REPORT_RENDER_FAILED' }, 500)
  }
}

export const config: Config = { path: '/api/reports-v2' }
