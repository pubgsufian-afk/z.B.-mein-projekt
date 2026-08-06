import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings } from './_shared/company-settings.mts'
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
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const ownerEmails = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = ownerEmails.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, role }
}

function clean(value: unknown, maximum = 120) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safePdfText(value: unknown, maximum = 120) {
  return clean(value, maximum).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
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

function rowFromSession(
  current: { start: ReportEventRow; breaks: number; breakStart: ReportEventRow | null; events: ReportEventRow[] },
  end: ReportEventRow | null,
  shift: Schedule | undefined,
  employeeName: string,
  date: string,
): ReportRow {
  const gross = end ? Math.max(0, Math.round((new Date(end.client_occurred_at).getTime() - new Date(current.start.client_occurred_at).getTime()) / 60000)) : 0
  const pause = current.breaks || Number(shift?.pauseMinutes || 0)
  return {
    employeeName,
    date,
    plannedStart: clean(shift?.start) || '-',
    plannedEnd: clean(shift?.end) || '-',
    actualStart: timeOnly(current.start.client_occurred_at),
    actualEnd: end ? timeOnly(end.client_occurred_at) : '-',
    pauseMinutes: pause,
    netMinutes: end ? Math.max(0, gross - pause) : 0,
    location: clean(shift?.location || current.start.object_id) || '-',
    warning: current.events.some((event) => event.location_status !== 'inside' || event.offline_captured),
  }
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

  const grouped = new Map<string, ReportEventRow[]>()
  for (const event of events) {
    const key = `${event.user_id}:${dateOnly(event.event_date)}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(event)
  }

  const rows: ReportRow[] = []
  for (const [key, dayEvents] of grouped) {
    const separator = key.indexOf(':')
    const userId = key.slice(0, separator)
    const date = key.slice(separator + 1)
    const ordered = [...dayEvents].sort((a, b) => new Date(a.client_occurred_at).getTime() - new Date(b.client_occurred_at).getTime())
    let current: { start: ReportEventRow; breaks: number; breakStart: ReportEventRow | null; events: ReportEventRow[] } | null = null
    let sessionIndex = 0
    for (const event of ordered) {
      if (event.action === 'clock-in') {
        if (current) {
          const shift = scheduleById.get(String(current.start.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
          rows.push(rowFromSession(current, null, shift, names.get(userId) || clean(shift?.employeeName) || 'Mitarbeiter', date))
          sessionIndex += 1
        }
        current = { start: event, breaks: 0, breakStart: null, events: [event] }
        continue
      }
      if (!current) continue
      current.events.push(event)
      if (event.action === 'break-start') current.breakStart = event
      if (event.action === 'break-end' && current.breakStart) {
        current.breaks += Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(current.breakStart.client_occurred_at).getTime()) / 60000))
        current.breakStart = null
      }
      if (event.action === 'clock-out') {
        const shift = scheduleById.get(String(current.start.schedule_id || event.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
        rows.push(rowFromSession(current, event, shift, names.get(userId) || clean(shift?.employeeName) || 'Mitarbeiter', date))
        current = null
        sessionIndex += 1
      }
    }
    if (current) {
      const shift = scheduleById.get(String(current.start.schedule_id || '')) || schedulesByDay.get(key)?.[sessionIndex]
      rows.push(rowFromSession(current, null, shift, names.get(userId) || clean(shift?.employeeName) || 'Mitarbeiter', date))
    }
  }

  const existing = new Set(rows.map((row) => `${row.employeeName}:${row.date}:${row.plannedStart}:${row.plannedEnd}`))
  for (const shift of schedules) {
    const employeeName = clean(shift.employeeName) || names.get(String(shift.employeeUserId || '')) || 'Mitarbeiter'
    const key = `${employeeName}:${shift.date}:${shift.start}:${shift.end}`
    if (existing.has(key)) continue
    rows.push({
      employeeName,
      date: clean(shift.date),
      plannedStart: clean(shift.start) || '-',
      plannedEnd: clean(shift.end) || '-',
      actualStart: '-',
      actualEnd: '-',
      pauseMinutes: Number(shift.pauseMinutes || 0),
      netMinutes: 0,
      location: clean(shift.location) || '-',
      warning: false,
    })
  }
  return rows.sort((a, b) => `${a.employeeName}-${a.date}-${a.plannedStart}`.localeCompare(`${b.employeeName}-${b.date}-${b.plannedStart}`, 'de'))
}

function summarize(rows: ReportRow[]) {
  const employeeTotals = new Map<string, number>()
  let grandTotal = 0
  for (const row of rows) {
    employeeTotals.set(row.employeeName, (employeeTotals.get(row.employeeName) || 0) + row.netMinutes)
    grandTotal += row.netMinutes
  }
  return { employeeTotals, grandTotal }
}

async function buildPdf(request: Request, rows: ReportRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf, request)
  const pageWidth = 842
  const pageHeight = 595
  const margin = 34
  const columns = [34, 155, 220, 292, 366, 425, 492, 700]
  let page: ReturnType<typeof pdf.addPage>
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight])
    pageNumber += 1
    drawCenteredShieldLogo(page, logo, pageWidth, pageHeight - 22, 64)
    const company = safePdfText(settings.companyName || 'Habun Security', 70)
    const phone = safePdfText(settings.phone || 'Telefon nicht hinterlegt', 70)
    const email = safePdfText(settings.email || 'E-Mail nicht hinterlegt', 90)
    page.drawText(company, { x: centeredTextX(bold, company, 16, pageWidth), y: 482, size: 16, font: bold, color: rgb(.08, .08, .08) })
    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, pageWidth), y: 466, size: 8.5, font: regular })
    page.drawText(email, { x: centeredTextX(regular, email, 8.5, pageWidth), y: 453, size: 8.5, font: regular })
    page.drawText('Stundenbericht', { x: margin, y: 424, size: 15, font: bold })
    page.drawText(safePdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 408, size: 8.5, font: regular })
    y = 378
    const headers = ['Name', 'Datum', 'Plan', 'Ist', 'Pause', 'Netto', 'Einsatzort', 'Hinweis']
    headers.forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 8, font: bold }))
    y -= 8
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .7, color: rgb(.45, .45, .45) })
    y -= 15
  }

  newPage()
  for (const row of rows) {
    if (y < 58) newPage()
    const values = [
      safePdfText(row.employeeName, 22),
      safePdfText(row.date, 10),
      safePdfText(`${row.plannedStart}-${row.plannedEnd}`, 14),
      safePdfText(`${row.actualStart}-${row.actualEnd}`, 14),
      `${row.pauseMinutes} Min.`,
      `${hours(row.netMinutes)} Std.`,
      safePdfText(row.location, 28),
      row.warning ? 'Pruefen' : '',
    ]
    values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.4, font: regular }))
    y -= 18
  }

  const summary = summarize(rows)
  if (y < 110) newPage()
  y -= 4
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .8 })
  y -= 20
  page.drawText('Summen', { x: margin, y, size: 11, font: bold })
  for (const [name, total] of summary.employeeTotals) {
    y -= 16
    if (y < 55) newPage()
    page.drawText(safePdfText(`${name}: ${hours(total)} Stunden`, 100), { x: margin, y, size: 9, font: regular })
  }
  y -= 20
  page.drawText(safePdfText(`Gesamtsumme: ${hours(summary.grandTotal)} Stunden`), { x: margin, y, size: 11, font: bold })
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
  const sheet = workbook.addWorksheet('Arbeitszeiten', { views: [{ state: 'frozen', ySplit: 6 }] })
  sheet.addRow([clean(settings.companyName) || 'Habun Security'])
  sheet.addRow([clean(settings.phone), clean(settings.email)])
  sheet.addRow([`Zeitraum ${from} bis ${to}`])
  sheet.addRow([])
  sheet.addRow(['Mitarbeiter', 'Datum', 'Plan Beginn', 'Plan Ende', 'Ist Beginn', 'Ist Ende', 'Pause Min.', 'Netto Std.', 'Einsatzort', 'Hinweis']).font = { bold: true }
  for (const row of rows) {
    sheet.addRow([row.employeeName, row.date, row.plannedStart, row.plannedEnd, row.actualStart, row.actualEnd, row.pauseMinutes, Number((row.netMinutes / 60).toFixed(2)), row.location, row.warning ? 'Prüfen' : ''])
  }
  sheet.columns = [{ width: 28 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 30 }, { width: 12 }]
  const totals = workbook.addWorksheet('Summen')
  totals.addRow([clean(settings.companyName) || 'Habun Security', 'Stundensummen'])
  totals.addRow([`Zeitraum ${from} bis ${to}`])
  totals.addRow([])
  totals.addRow(['Mitarbeiter', 'Stunden']).font = { bold: true }
  const summary = summarize(rows)
  for (const [name, total] of summary.employeeTotals) totals.addRow([name, Number((total / 60).toFixed(2))])
  totals.addRow([])
  totals.addRow(['Gesamtsumme', Number((summary.grandTotal / 60).toFixed(2))]).font = { bold: true }
  totals.columns = [{ width: 30 }, { width: 15 }]
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
  if (!rows.length) return json({ message: 'Für den ausgewählten Zeitraum wurden keine Daten gefunden.', code: 'NO_DATA' }, 404)

  try {
    if (format === 'xlsx') {
      const bytes = await buildExcel(rows, from, to)
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.xlsx"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
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
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('Habun fixed report rendering', error)
    return json({ message: 'Die Berichtsdatei konnte nicht erzeugt werden.', code: 'REPORT_RENDER_FAILED' }, 500)
  }
}
