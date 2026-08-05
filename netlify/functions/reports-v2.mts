import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'

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

function databaseUrl() {
  return Netlify.env.get('ATTENDANCE_DATABASE_URL') || Netlify.env.get('DATABASE_URL') || Netlify.env.get('NETLIFY_DATABASE_URL') || ''
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
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date) : '–'
}

function hours(minutes: number) {
  return (minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function groupRows(events: Record<string, unknown>[], schedules: Record<string, unknown>[]) {
  const scheduleMap = new Map<string, Record<string, unknown>>()
  for (const shift of schedules) scheduleMap.set(`${shift.employeeUserId}:${shift.date}`, shift)
  const eventMap = new Map<string, Record<string, unknown>[]>()
  for (const event of events) {
    const key = `${event.user_id}:${String(event.event_date).slice(0, 10)}`
    if (!eventMap.has(key)) eventMap.set(key, [])
    eventMap.get(key)!.push(event)
  }
  const keys = new Set([...scheduleMap.keys(), ...eventMap.keys()])
  return [...keys].map((key) => {
    const [userId, date] = key.split(':')
    const shift = scheduleMap.get(key)
    const items = (eventMap.get(key) || []).sort((a, b) => String(a.client_occurred_at).localeCompare(String(b.client_occurred_at)))
    const start = items.find((item) => item.action === 'clock-in')
    const end = [...items].reverse().find((item) => item.action === 'clock-out')
    const pause = Math.max(0, Number(shift?.pauseMinutes || 0))
    const gross = start && end ? minutesBetween(start.client_occurred_at, end.client_occurred_at) : 0
    const net = Math.max(0, gross - pause)
    return {
      userId,
      employeeName: safeText(shift?.employeeName || userId),
      date,
      plannedStart: safeText(shift?.start || '–'),
      plannedEnd: safeText(shift?.end || '–'),
      actualStart: timeOf(start?.client_occurred_at),
      actualEnd: timeOf(end?.client_occurred_at),
      pauseMinutes: pause,
      netMinutes: net,
      location: safeText(shift?.location || start?.object_id || end?.object_id || '–'),
      warning: items.some((item) => item.location_status !== 'inside' || item.offline_captured),
    }
  }).sort((a, b) => `${a.employeeName}-${a.date}`.localeCompare(`${b.employeeName}-${b.date}`))
}

async function buildPdf(request: Request, rows: ReturnType<typeof groupRows>, reportType: string, from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
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
  let page
  let y
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
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.employeeName, (totals.get(row.employeeName) || 0) + row.netMinutes)
  if (y < margin + 60) newPage()
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7 })
  y -= 18
  page.drawText('Summen', { x: margin, y, size: 10, font: bold })
  for (const [name, total] of totals) {
    y -= 15
    if (y < margin + 20) newPage()
    page.drawText(`${name}: ${hours(total)} Stunden`, { x: margin, y, size: 9, font: regular })
  }
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
  const url = databaseUrl()
  if (!url) return json({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.' }, 503)
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(url)
    const events = await sql(
      `SELECT id, user_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date
          AND (cardinality($3::text[]) = 0 OR user_id = ANY($3::text[]))
        ORDER BY user_id, event_date, client_occurred_at`,
      [from, to, userIds],
    )
    const schedules = await fetchSchedules(request, from, to)
    let rows = groupRows(events, schedules)
    if (userIds.length) rows = rows.filter((row) => userIds.includes(row.userId))
    if (!rows.length) return json({ message: 'Für den gewählten Zeitraum sind keine Daten vorhanden.', code: 'NO_DATA' }, 404)
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
    console.error('Habun reports v2', error)
    return json({ message: 'Der Bericht konnte nicht erstellt werden.' }, 500)
  }
}

export const config: Config = { path: '/api/reports-v2' }
