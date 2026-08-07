import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings } from './_shared/company-settings.mts'
import { attendanceEventNeedsReview } from './_shared/report-warning.mjs'
import { loadReportEvents, type ReportEventRow } from './_shared/report-database.mts'
import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
type Schedule = {
  id?: string
  employeeUserId?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  pauseMinutes?: number
  location?: string
}
type SessionRow = {
  employeeName: string
  actualStart: string
  actualEnd: string
  pauseMinutes: number
  netMinutes: number
  location: string
  warning: boolean
}
type ReportRow = {
  employeeName: string
  date: string
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
  return { role }
}

function clean(value: unknown, maximum = 120) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function pdfText(value: unknown, maximum = 120) {
  return clean(value, maximum).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function dateOnly(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
}

function timeOnly(value: unknown) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date)
    : '-'
}

function hours(minutes: number) {
  return (Math.max(0, minutes) / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function fetchJson(request: Request, path: string) {
  try {
    const response = await fetch(new URL(path, request.url), { headers: request.headers, cache: 'no-store' })
    return response.ok ? await response.json().catch(() => ({})) : {}
  } catch {
    return {}
  }
}

async function loadSchedules(request: Request, from: string, to: string): Promise<Schedule[]> {
  const payload = await fetchJson(request, `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) as { entries?: Schedule[] }
  return Array.isArray(payload.entries) ? payload.entries : []
}

async function loadNames(request: Request) {
  const payload = await fetchJson(request, '/api/registrations') as { employees?: Array<{ userId?: string; id?: string; fullName?: string }> }
  return new Map((payload.employees || []).map((employee) => [String(employee.userId || employee.id || ''), clean(employee.fullName)]))
}

function buildRows(events: ReportEventRow[], schedules: Schedule[], names: Map<string, string>): ReportRow[] {
  const scheduleById = new Map(schedules.map((shift) => [String(shift.id || ''), shift]))
  const schedulesByDay = new Map<string, Schedule[]>()
  for (const shift of schedules) {
    const key = `${shift.employeeUserId || ''}:${shift.date || ''}`
    if (!schedulesByDay.has(key)) schedulesByDay.set(key, [])
    schedulesByDay.get(key)!.push(shift)
  }
  for (const list of schedulesByDay.values()) list.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))

  const byDay = new Map<string, ReportEventRow[]>()
  for (const event of events) {
    const key = `${event.user_id}:${dateOnly(event.event_date)}`
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(event)
  }

  const rows: ReportRow[] = []
  for (const [key, items] of byDay) {
    const separator = key.indexOf(':')
    const userId = key.slice(0, separator)
    const date = key.slice(separator + 1)
    const ordered = [...items].sort((a, b) => new Date(a.client_occurred_at).getTime() - new Date(b.client_occurred_at).getTime())
    const daySchedules = schedulesByDay.get(key) || []
    const sessions: SessionRow[] = []
    let start: ReportEventRow | null = null
    let breakStart: ReportEventRow | null = null
    let breakMinutes = 0
    let sessionEvents: ReportEventRow[] = []
    let sessionIndex = 0

    const finish = (end: ReportEventRow | null) => {
      if (!start) return
      const shift = scheduleById.get(String(start.schedule_id || end?.schedule_id || '')) || daySchedules[sessionIndex]
      const gross = end ? Math.max(0, Math.round((new Date(end.client_occurred_at).getTime() - new Date(start.client_occurred_at).getTime()) / 60000)) : 0
      const adjustedPause = end?.pause_minutes_adjustment
      const pause = adjustedPause !== null && adjustedPause !== undefined
        ? Math.max(0, Number(adjustedPause) || 0)
        : breakMinutes || Number(shift?.pauseMinutes || 0)
      sessions.push({
        employeeName: names.get(userId) || clean(shift?.employeeName) || 'Mitarbeiter',
        actualStart: timeOnly(start.client_occurred_at),
        actualEnd: end ? timeOnly(end.client_occurred_at) : '-',
        pauseMinutes: pause,
        netMinutes: end ? Math.max(0, gross - pause) : 0,
        location: clean(shift?.location || start.object_id) || '-',
        warning: !end || sessionEvents.some(attendanceEventNeedsReview),
      })
      start = null
      breakStart = null
      breakMinutes = 0
      sessionEvents = []
      sessionIndex += 1
    }

    for (const event of ordered) {
      if (event.action === 'clock-in') {
        finish(null)
        start = event
        sessionEvents = [event]
      } else if (start) {
        sessionEvents.push(event)
        if (event.action === 'break-start') breakStart = event
        if (event.action === 'break-end' && breakStart) {
          breakMinutes += Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(breakStart.client_occurred_at).getTime()) / 60000))
          breakStart = null
        }
        if (event.action === 'clock-out') finish(event)
      }
    }
    finish(null)

    if (!sessions.length) continue
    const uniqueLocations = [...new Set(sessions.map((session) => session.location).filter((value) => value && value !== '-'))]
    const complete = sessions.every((session) => session.actualEnd !== '-')
    rows.push({
      employeeName: sessions[0].employeeName,
      date,
      actualStart: sessions[0].actualStart,
      actualEnd: complete ? sessions[sessions.length - 1].actualEnd : '-',
      pauseMinutes: sessions.reduce((sum, session) => sum + session.pauseMinutes, 0),
      netMinutes: sessions.reduce((sum, session) => sum + session.netMinutes, 0),
      location: uniqueLocations.length ? uniqueLocations.join(', ') : '-',
      warning: sessions.some((session) => session.warning),
    })
  }

  return rows.sort((a, b) => `${a.employeeName}-${a.date}`.localeCompare(`${b.employeeName}-${b.date}`, 'de'))
}

function totals(rows: ReportRow[]) {
  const employees = new Map<string, number>()
  let grand = 0
  for (const row of rows) {
    employees.set(row.employeeName, (employees.get(row.employeeName) || 0) + row.netMinutes)
    grand += row.netMinutes
  }
  return { employees, grand }
}

async function buildPdf(request: Request, rows: ReportRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf, request)
  const width = 842
  const height = 595
  const margin = 34
  const columns = [34, 160, 235, 305, 375, 450, 535, 730]
  let page: ReturnType<typeof pdf.addPage>
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([width, height])
    pageNumber += 1
    drawCenteredShieldLogo(page, logo, width, height - 22, 64)
    const company = pdfText(settings.companyName || 'Habun Security', 70)
    const phone = pdfText(settings.phone || 'Telefon nicht hinterlegt', 70)
    const email = pdfText(settings.email || 'E-Mail nicht hinterlegt', 90)
    page.drawText(company, { x: centeredTextX(bold, company, 16, width), y: 482, size: 16, font: bold, color: rgb(.08, .08, .08) })
    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 466, size: 8.5, font: regular })
    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 453, size: 8.5, font: regular })
    page.drawText('Stundenzettel', { x: margin, y: 424, size: 15, font: bold })
    page.drawText(pdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 408, size: 8.5, font: regular })
    y = 378
    ;['Name', 'Datum', 'Beginn', 'Ende', 'Pause', 'Tagesstunden', 'Einsatzort', 'Hinweis'].forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 8, font: bold }))
    y -= 8
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .7, color: rgb(.45, .45, .45) })
    y -= 15
  }

  newPage()
  for (const row of rows) {
    if (y < 58) newPage()
    const values = [
      pdfText(row.employeeName, 22),
      row.date,
      row.actualStart,
      row.actualEnd,
      `${row.pauseMinutes} Min.`,
      `${hours(row.netMinutes)} Std.`,
      pdfText(row.location, 30),
      row.warning ? 'Pruefen' : '',
    ]
    values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.4, font: regular }))
    y -= 18
  }

  const summary = totals(rows)
  if (y < 110) newPage()
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .8 })
  y -= 20
  page.drawText('Gesamtstunden', { x: margin, y, size: 11, font: bold })
  for (const [name, total] of summary.employees) {
    y -= 16
    if (y < 55) newPage()
    page.drawText(pdfText(`${name}: ${hours(total)} Stunden`, 100), { x: margin, y, size: 9, font: regular })
  }
  y -= 20
  page.drawText(pdfText(`Gesamtsumme aller ausgewaehlten Mitarbeiter: ${hours(summary.grand)} Stunden`), { x: margin, y, size: 11, font: bold })
  return pdf.save()
}

async function buildExcel(rows: ReportRow[], from: string, to: string) {
  const module = await import('exceljs')
  const Workbook = module.Workbook || module.default?.Workbook
  if (!Workbook) throw new Error('Excel-Modul ist nicht verfügbar.')
  const settings = await readCompanySettings()
  const workbook = new Workbook()
  workbook.creator = clean(settings.companyName) || 'Habun Security'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Stundenzettel', { views: [{ state: 'frozen', ySplit: 6 }] })
  sheet.addRow([clean(settings.companyName) || 'Habun Security'])
  sheet.addRow([clean(settings.phone), clean(settings.email)])
  sheet.addRow([`Stundenzettel - Zeitraum ${from} bis ${to}`])
  sheet.addRow([])
  sheet.addRow(['Mitarbeiter', 'Datum', 'Arbeitsbeginn', 'Arbeitsende', 'Pause Min.', 'Tagesstunden', 'Einsatzort', 'Hinweis']).font = { bold: true }
  for (const row of rows) sheet.addRow([row.employeeName, row.date, row.actualStart, row.actualEnd, row.pauseMinutes, Number((row.netMinutes / 60).toFixed(2)), row.location, row.warning ? 'Prüfen' : ''])
  sheet.columns = [{ width: 28 }, { width: 13 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 15 }, { width: 34 }, { width: 12 }]

  const sumSheet = workbook.addWorksheet('Gesamtstunden')
  sumSheet.addRow([clean(settings.companyName) || 'Habun Security', 'Stundenzettel'])
  sumSheet.addRow([`Zeitraum ${from} bis ${to}`])
  sumSheet.addRow([])
  sumSheet.addRow(['Mitarbeiter', 'Gesamtstunden']).font = { bold: true }
  const summary = totals(rows)
  for (const [name, total] of summary.employees) sumSheet.addRow([name, Number((total / 60).toFixed(2))])
  sumSheet.addRow([])
  sumSheet.addRow(['Gesamtsumme', Number((summary.grand / 60).toFixed(2))]).font = { bold: true }
  sumSheet.columns = [{ width: 30 }, { width: 18 }]
  return workbook.xlsx.writeBuffer()
}

export default async function unifiedReportsFixed(request: Request, _context: Context) {
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

  let events: ReportEventRow[]
  try {
    events = await loadReportEvents(from, to, userIds)
  } catch (error) {
    console.error('Habun fixed report database query', error)
    return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.', code: 'REPORT_QUERY_FAILED' }, 500)
  }

  const [allSchedules, names] = await Promise.all([loadSchedules(request, from, to), loadNames(request)])
  const schedules = userIds.length ? allSchedules.filter((shift) => userIds.includes(String(shift.employeeUserId || ''))) : allSchedules
  const rows = buildRows(events, schedules, names)
  if (!rows.length) return json({ message: 'Für den ausgewählten Zeitraum wurden keine gebuchten Arbeitszeiten gefunden.', code: 'NO_DATA' }, 404)

  try {
    if (format === 'xlsx') {
      const bytes = await buildExcel(rows, from, to)
      return new Response(bytes as BodyInit, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Habun-Stundenzettel-${from}-bis-${to}.xlsx"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
    }
    const bytes = await buildPdf(request, rows, from, to)
    return new Response(bytes as BodyInit, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Habun-Stundenzettel-${from}-bis-${to}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
  } catch (error) {
    console.error('Habun fixed report rendering', error)
    return json({ message: 'Der Stundenzettel konnte nicht erzeugt werden.', code: 'REPORT_RENDER_FAILED' }, 500)
  }
}
