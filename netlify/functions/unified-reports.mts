import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings } from './_shared/company-settings.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null

type EventRow = {
  id: string
  user_id: string
  schedule_id: string | null
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  object_id: string | null
  location_status: string
  offline_captured: boolean
}

type Schedule = {
  id?: string
  employeeUserId?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  pauseMinutes?: number
  location?: string
  workArea?: string
}

type ReportRow = {
  employeeName: string
  date: string
  plannedStart: string
  plannedEnd: string
  actualStart: string
  actualEnd: string
  pauseMinutes: number
  netMinutes: number
  location: string
  warning: boolean
}

const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const owners = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

function text(value: unknown) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim()
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

function timeOnly(value: unknown) {
  if (!value) return '–'
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date)
    : '–'
}

function hours(minutes: number) {
  return (Math.max(0, minutes) / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function fetchJson(request: Request, path: string) {
  try {
    const response = await fetch(new URL(path, request.url), { headers: request.headers, cache: 'no-store' })
    return response.ok ? await response.json().catch(() => ({})) : {}
  } catch { return {} }
}

async function loadSchedules(request: Request, from: string, to: string): Promise<Schedule[]> {
  const payload = await fetchJson(request, `/api/schedule-v2?resource=entries&from=${from}&to=${to}`) as { entries?: Schedule[] }
  return Array.isArray(payload.entries) ? payload.entries : []
}

async function loadNames(request: Request) {
  const payload = await fetchJson(request, '/api/registrations') as { employees?: Array<{ userId?: string; id?: string; fullName?: string }> }
  return new Map((payload.employees || []).map((employee) => [String(employee.userId || employee.id || ''), text(employee.fullName)]))
}

function buildRows(events: EventRow[], schedules: Schedule[], names: Map<string, string>): ReportRow[] {
  const scheduleById = new Map(schedules.map((shift) => [String(shift.id || ''), shift]))
  const schedulesByDay = new Map<string, Schedule[]>()
  for (const shift of schedules) {
    const key = `${shift.employeeUserId || ''}:${shift.date || ''}`
    if (!schedulesByDay.has(key)) schedulesByDay.set(key, [])
    schedulesByDay.get(key)!.push(shift)
  }
  for (const list of schedulesByDay.values()) list.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))

  const byUserDay = new Map<string, EventRow[]>()
  for (const event of events) {
    const key = `${event.user_id}:${dateOnly(event.event_date)}`
    if (!byUserDay.has(key)) byUserDay.set(key, [])
    byUserDay.get(key)!.push(event)
  }

  const rows: ReportRow[] = []
  for (const [key, dayEvents] of byUserDay) {
    const separator = key.indexOf(':')
    const userId = key.slice(0, separator)
    const date = key.slice(separator + 1)
    const ordered = [...dayEvents].sort((a, b) => new Date(a.client_occurred_at).getTime() - new Date(b.client_occurred_at).getTime())
    let current: { start: EventRow; breaks: number; breakStart: EventRow | null; events: EventRow[] } | null = null
    let sessionIndex = 0
    for (const event of ordered) {
      if (event.action === 'clock-in') {
        if (current) {
          const shift = scheduleById.get(String(current.start.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
          rows.push(rowFromSession(current, null, shift, names.get(userId) || text(shift?.employeeName) || 'Mitarbeiter', date))
          sessionIndex += 1
        }
        current = { start: event, breaks: 0, breakStart: null, events: [event] }
      } else if (current) {
        current.events.push(event)
        if (event.action === 'break-start') current.breakStart = event
        if (event.action === 'break-end' && current.breakStart) {
          current.breaks += Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(current.breakStart.client_occurred_at).getTime()) / 60000))
          current.breakStart = null
        }
        if (event.action === 'clock-out') {
          const shift = scheduleById.get(String(current.start.schedule_id || event.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
          rows.push(rowFromSession(current, event, shift, names.get(userId) || text(shift?.employeeName) || 'Mitarbeiter', date))
          current = null
          sessionIndex += 1
        }
      }
    }
    if (current) {
      const shift = scheduleById.get(String(current.start.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
      rows.push(rowFromSession(current, null, shift, names.get(userId) || text(shift?.employeeName) || 'Mitarbeiter', date))
    }
  }

  const existingKeys = new Set(rows.map((row) => `${row.employeeName}:${row.date}:${row.plannedStart}:${row.plannedEnd}`))
  for (const shift of schedules) {
    const employeeName = text(shift.employeeName) || names.get(String(shift.employeeUserId || '')) || 'Mitarbeiter'
    const key = `${employeeName}:${shift.date}:${shift.start}:${shift.end}`
    if (existingKeys.has(key)) continue
    rows.push({ employeeName, date: text(shift.date), plannedStart: text(shift.start) || '–', plannedEnd: text(shift.end) || '–', actualStart: '–', actualEnd: '–', pauseMinutes: Number(shift.pauseMinutes || 0), netMinutes: 0, location: text(shift.location) || '–', warning: false })
  }

  return rows.sort((a, b) => `${a.employeeName}-${a.date}-${a.plannedStart}`.localeCompare(`${b.employeeName}-${b.date}-${b.plannedStart}`, 'de'))
}

function rowFromSession(
  current: { start: EventRow; breaks: number; breakStart: EventRow | null; events: EventRow[] },
  end: EventRow | null,
  shift: Schedule | undefined,
  employeeName: string,
  date: string,
): ReportRow {
  const gross = end ? Math.max(0, Math.round((new Date(end.client_occurred_at).getTime() - new Date(current.start.client_occurred_at).getTime()) / 60000)) : 0
  const configuredPause = current.breaks || Number(shift?.pauseMinutes || 0)
  return {
    employeeName,
    date,
    plannedStart: text(shift?.start) || '–',
    plannedEnd: text(shift?.end) || '–',
    actualStart: timeOnly(current.start.client_occurred_at),
    actualEnd: end ? timeOnly(end.client_occurred_at) : '–',
    pauseMinutes: configuredPause,
    netMinutes: end ? Math.max(0, gross - configuredPause) : 0,
    location: text(shift?.location || current.start.object_id) || '–',
    warning: current.events.some((event) => event.location_status !== 'inside' || event.offline_captured),
  }
}

function summarize(rows: ReportRow[]) {
  const employeeTotals = new Map<string, number>()
  const monthly = new Map<string, number>()
  let grandTotal = 0
  for (const row of rows) {
    employeeTotals.set(row.employeeName, (employeeTotals.get(row.employeeName) || 0) + row.netMinutes)
    const monthKey = `${row.employeeName}|${row.date.slice(0, 7)}`
    monthly.set(monthKey, (monthly.get(monthKey) || 0) + row.netMinutes)
    grandTotal += row.netMinutes
  }
  return { employeeTotals, monthly, grandTotal }
}

async function buildPdf(request: Request, rows: ReportRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: any = null
  try {
    const response = await fetch(new URL(settings.logoUrl || '/habun-logo.png', request.url))
    if (response.ok) {
      const bytes = await response.arrayBuffer()
      logo = response.headers.get('content-type')?.includes('jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
    }
  } catch {}

  const pageWidth = 842
  const pageHeight = 595
  const margin = 36
  const columns = [36, 160, 226, 296, 370, 425, 485, 700]
  let page: any
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight])
    pageNumber += 1
    y = pageHeight - margin
    if (logo) {
      const scale = Math.min(86 / logo.width, 64 / logo.height)
      page.drawImage(logo, { x: margin, y: y - logo.height * scale + 8, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(settings.companyName, { x: 135, y: y - 2, size: 17, font: bold, color: rgb(.08, .08, .08) })
    page.drawText(settings.phone || 'Telefon nicht hinterlegt', { x: 135, y: y - 18, size: 8.5, font: regular, color: rgb(.2, .2, .2) })
    page.drawText(settings.email || 'E-Mail nicht hinterlegt', { x: 135, y: y - 31, size: 8.5, font: regular, color: rgb(.2, .2, .2) })
    page.drawText('Stundenbericht', { x: margin, y: y - 66, size: 15, font: bold })
    page.drawText(`Zeitraum ${from} bis ${to} · Erstellt ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date())} · Seite ${pageNumber}`, { x: margin, y: y - 82, size: 8.5, font: regular })
    y -= 110
    const headers = ['Name', 'Datum', 'Plan', 'Ist', 'Pause', 'Netto', 'Einsatzort', 'Hinweis']
    headers.forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 8, font: bold }))
    y -= 8
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .7, color: rgb(.45, .45, .45) })
    y -= 14
  }

  newPage()
  for (const row of rows) {
    if (y < 70) newPage()
    const values = [row.employeeName.slice(0, 22), row.date, `${row.plannedStart}-${row.plannedEnd}`, `${row.actualStart}-${row.actualEnd}`, `${row.pauseMinutes} Min.`, `${hours(row.netMinutes)} Std.`, row.location.slice(0, 30), row.warning ? 'Prüfen' : '']
    values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.4, font: regular }))
    y -= 18
  }

  const summary = summarize(rows)
  if (y < 120) newPage()
  y -= 4
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .8 })
  y -= 20
  page.drawText('Summen', { x: margin, y, size: 11, font: bold })
  for (const [name, total] of summary.employeeTotals) {
    y -= 16
    if (y < 55) newPage()
    page.drawText(`${name}: ${hours(total)} Stunden`, { x: margin, y, size: 9, font: regular })
  }
  y -= 20
  page.drawText(`Gesamtsumme: ${hours(summary.grandTotal)} Stunden`, { x: margin, y, size: 11, font: bold })
  return pdf.save()
}

async function buildExcel(rows: ReportRow[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const settings = await readCompanySettings()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = settings.companyName
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Arbeitszeiten', { views: [{ state: 'frozen', ySplit: 6 }] })
  sheet.addRow([settings.companyName])
  sheet.addRow([settings.phone, settings.email])
  sheet.addRow([`Zeitraum ${from} bis ${to}`])
  sheet.addRow([`Erstellt ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date())}`])
  sheet.addRow([])
  const header = sheet.addRow(['Name', 'Datum', 'Plan Beginn', 'Plan Ende', 'Ist Beginn', 'Ist Ende', 'Pause Min.', 'Netto Std.', 'Einsatzort', 'Hinweis'])
  header.font = { bold: true }
  for (const row of rows) sheet.addRow([row.employeeName, row.date, row.plannedStart, row.plannedEnd, row.actualStart, row.actualEnd, row.pauseMinutes, Number(hours(row.netMinutes).replace(',', '.')), row.location, row.warning ? 'Prüfen' : ''])
  sheet.columns = [{ width: 25 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 30 }, { width: 12 }]
  const totals = workbook.addWorksheet('Summen')
  totals.addRow([settings.companyName, 'Stundensummen'])
  totals.addRow([`Zeitraum ${from} bis ${to}`])
  totals.addRow([])
  totals.addRow(['Mitarbeiter', 'Stunden']).font = { bold: true }
  const summary = summarize(rows)
  for (const [name, total] of summary.employeeTotals) totals.addRow([name, Number(hours(total).replace(',', '.'))])
  totals.addRow([])
  totals.addRow(['Gesamtsumme', Number(hours(summary.grandTotal).replace(',', '.'))]).font = { bold: true }
  totals.columns = [{ width: 30 }, { width: 15 }]
  return workbook.xlsx.writeBuffer()
}

export default async function unifiedReports(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung für Berichte.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const from = String(body.from || '')
  const to = String(body.to || '')
  const format = body.format === 'xlsx' ? 'xlsx' : 'pdf'
  const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : []
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return json({ message: 'Der Zeitraum ist ungültig.' }, 400)
  const connection = databaseConnectionString()
  if (!connection) return json({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.' }, 503)

  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(connection)
    const events = await sql(
      `SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date
          AND (cardinality($3::text[]) = 0 OR user_id = ANY($3::text[]))
        ORDER BY user_id, event_date, client_occurred_at`,
      [from, to, userIds],
    ) as EventRow[]
    const [schedules, names] = await Promise.all([loadSchedules(request, from, to), loadNames(request)])
    const selectedSchedules = userIds.length ? schedules.filter((shift) => userIds.includes(String(shift.employeeUserId || ''))) : schedules
    const rows = buildRows(events, selectedSchedules, names)
    if (!rows.length) return json({ message: 'Für den ausgewählten Zeitraum wurden keine Daten gefunden.' }, 404)

    if (format === 'xlsx') {
      const bytes = await buildExcel(rows, from, to)
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.xlsx"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const bytes = await buildPdf(request, rows, from, to)
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Unified reports', error)
    return json({ message: 'Der Bericht konnte nicht erstellt werden.' }, 500)
  }
}

export const config: Config = { path: '/api/unified-reports' }
