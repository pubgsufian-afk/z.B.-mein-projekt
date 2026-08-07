import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings } from './_shared/company-settings.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

type Scope = 'actual' | 'planned'
type Format = 'pdf' | 'xlsx'
type AttendanceEvent = {
  id: string
  user_id: string
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  schedule_id: string | null
  object_id: string | null
  location_status: string
  offline_captured: boolean
  pause_minutes_adjustment: number | null
}
type ScheduleEntry = {
  id?: string
  employeeUserId?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  pauseMinutes?: number
  location?: string
  workArea?: string
  status?: string
}
type ReportRow = {
  employeeName: string
  date: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  detail: string
}

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
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

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function plannedMinutes(date: string, start: string, end: string, pauseMinutes: number) {
  if (!date || !start || !end) return 0
  const startAt = new Date(`${date}T${start}:00`)
  let endAt = new Date(`${date}T${end}:00`)
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return 0
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000)
  const gross = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000))
  return Math.max(0, gross - Math.max(0, Number(pauseMinutes) || 0))
}

function decimalHours(minutes: number) {
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

async function loadNames(request: Request) {
  const payload = await fetchJson(request, '/api/registrations') as { employees?: Array<{ userId?: string; id?: string; fullName?: string }> }
  return new Map((payload.employees || []).map((employee) => [String(employee.userId || employee.id || ''), text(employee.fullName) || 'Mitarbeiter']))
}

async function loadSchedules(request: Request, from: string, to: string) {
  const payload = await fetchJson(request, `/api/schedule-v2?resource=entries&from=${from}&to=${to}`) as { entries?: ScheduleEntry[] }
  return Array.isArray(payload.entries) ? payload.entries : []
}

function buildPlannedRows(schedules: ScheduleEntry[], names: Map<string, string>): ReportRow[] {
  return schedules
    .filter((entry) => entry.status !== 'draft')
    .map((entry) => {
      const userId = String(entry.employeeUserId || '')
      const pauseMinutes = Math.max(0, Number(entry.pauseMinutes) || 0)
      return {
        employeeName: text(entry.employeeName) || names.get(userId) || 'Mitarbeiter',
        date: text(entry.date),
        start: text(entry.start) || '–',
        end: text(entry.end) || '–',
        pauseMinutes,
        netMinutes: plannedMinutes(text(entry.date), text(entry.start), text(entry.end), pauseMinutes),
        location: text(entry.location) || '–',
        detail: text(entry.workArea) || '–',
      }
    })
    .sort((left, right) => `${left.employeeName}-${left.date}-${left.start}`.localeCompare(`${right.employeeName}-${right.date}-${right.start}`, 'de'))
}

function buildActualRows(events: AttendanceEvent[], schedules: ScheduleEntry[], names: Map<string, string>, from: string, to: string): ReportRow[] {
  const scheduleById = new Map(schedules.map((entry) => [String(entry.id || ''), entry]))
  const currentByUser = new Map<string, { start: AttendanceEvent; breakStart: AttendanceEvent | null; breakMinutes: number }>()
  const rows: ReportRow[] = []
  const ordered = [...events].sort((left, right) => {
    const userOrder = String(left.user_id).localeCompare(String(right.user_id))
    if (userOrder) return userOrder
    return new Date(left.client_occurred_at).getTime() - new Date(right.client_occurred_at).getTime()
  })

  for (const event of ordered) {
    const userId = String(event.user_id || '')
    let current = currentByUser.get(userId) || null
    if (event.action === 'clock-in') {
      current = { start: event, breakStart: null, breakMinutes: 0 }
      currentByUser.set(userId, current)
      continue
    }
    if (!current) continue
    if (event.action === 'break-start') {
      current.breakStart = event
      continue
    }
    if (event.action === 'break-end' && current.breakStart) {
      current.breakMinutes += Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(current.breakStart.client_occurred_at).getTime()) / 60000))
      current.breakStart = null
      continue
    }
    if (event.action !== 'clock-out') continue

    const startDate = dateOnly(current.start.event_date)
    if (startDate >= from && startDate <= to) {
      const pauseMinutes = event.pause_minutes_adjustment !== null && event.pause_minutes_adjustment !== undefined
        ? Math.max(0, Number(event.pause_minutes_adjustment) || 0)
        : current.breakMinutes
      const gross = Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(current.start.client_occurred_at).getTime()) / 60000))
      const shift = scheduleById.get(String(current.start.schedule_id || event.schedule_id || ''))
      rows.push({
        employeeName: names.get(userId) || text(shift?.employeeName) || userId || 'Mitarbeiter',
        date: startDate,
        start: timeOnly(current.start.client_occurred_at),
        end: timeOnly(event.client_occurred_at),
        pauseMinutes,
        netMinutes: Math.max(0, gross - pauseMinutes),
        location: text(shift?.location || current.start.object_id || event.object_id) || '–',
        detail: current.start.location_status !== 'inside' || current.start.offline_captured || event.location_status !== 'inside' || event.offline_captured ? 'Prüfen' : '',
      })
    }
    currentByUser.delete(userId)
  }

  return rows.sort((left, right) => `${left.employeeName}-${left.date}-${left.start}`.localeCompare(`${right.employeeName}-${right.date}-${right.start}`, 'de'))
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

async function buildPdf(request: Request, rows: ReportRow[], from: string, to: string, scope: Scope) {
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

  const title = scope === 'planned' ? 'Dienstplanstunden – geplant' : 'Stundenzettel – tatsächliche Arbeitszeiten'
  const detailHeading = scope === 'planned' ? 'Arbeitsbereich' : 'Hinweis'
  const pageWidth = 842
  const pageHeight = 595
  const margin = 34
  const columns = [34, 175, 245, 305, 365, 430, 500, 675]
  let page: any
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight])
    pageNumber += 1
    y = pageHeight - margin
    if (logo) {
      const scale = Math.min(80 / logo.width, 58 / logo.height)
      page.drawImage(logo, { x: margin, y: y - logo.height * scale + 6, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(settings.companyName || 'Habun Security', { x: 126, y: y - 2, size: 16, font: bold, color: rgb(.08, .08, .08) })
    page.drawText(settings.phone || '', { x: 126, y: y - 17, size: 8, font: regular })
    page.drawText(settings.email || '', { x: 126, y: y - 30, size: 8, font: regular })
    page.drawText(title, { x: margin, y: y - 64, size: 14, font: bold })
    page.drawText(`Zeitraum ${from} bis ${to} · Seite ${pageNumber}`, { x: margin, y: y - 80, size: 8, font: regular })
    y -= 108
    const headers = ['Name', 'Datum', 'Beginn', 'Ende', 'Pause', 'Netto', 'Einsatzort', detailHeading]
    headers.forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 7.8, font: bold }))
    y -= 9
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: .7, color: rgb(.45, .45, .45) })
    y -= 14
  }

  newPage()
  for (const row of rows) {
    if (y < 72) newPage()
    const values = [row.employeeName.slice(0, 22), row.date, row.start, row.end, `${row.pauseMinutes} Min.`, `${decimalHours(row.netMinutes)} Std.`, row.location.slice(0, 28), row.detail.slice(0, 22)]
    values.forEach((value, index) => page.drawText(value || '–', { x: columns[index], y, size: 7.2, font: regular }))
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
    page.drawText(`${name}: ${decimalHours(total)} Stunden`, { x: margin, y, size: 9, font: regular })
  }
  y -= 20
  page.drawText(`Gesamtsumme: ${decimalHours(summary.grandTotal)} Stunden`, { x: margin, y, size: 11, font: bold })
  return pdf.save()
}

async function buildExcel(rows: ReportRow[], from: string, to: string, scope: Scope) {
  const ExcelJS = await import('exceljs')
  const settings = await readCompanySettings()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = settings.companyName || 'Habun Security'
  workbook.created = new Date()
  const title = scope === 'planned' ? 'Dienstplanstunden – geplant' : 'Stundenzettel – tatsächliche Arbeitszeiten'
  const detailHeading = scope === 'planned' ? 'Arbeitsbereich' : 'Hinweis'
  const sheet = workbook.addWorksheet(scope === 'planned' ? 'Dienstplanstunden' : 'Stundenzettel', { views: [{ state: 'frozen', ySplit: 6 }] })
  sheet.addRow([settings.companyName || 'Habun Security'])
  sheet.addRow([settings.phone || '', settings.email || ''])
  sheet.addRow([title])
  sheet.addRow([`Zeitraum ${from} bis ${to}`])
  sheet.addRow([])
  sheet.addRow(['Name', 'Datum', 'Beginn', 'Ende', 'Pause Min.', 'Netto Std.', 'Einsatzort', detailHeading]).font = { bold: true }
  for (const row of rows) {
    sheet.addRow([row.employeeName, row.date, row.start, row.end, row.pauseMinutes, Number((row.netMinutes / 60).toFixed(2)), row.location, row.detail])
  }
  sheet.columns = [{ width: 26 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 30 }, { width: 24 }]

  const totals = workbook.addWorksheet('Summen')
  totals.addRow([settings.companyName || 'Habun Security', title])
  totals.addRow([`Zeitraum ${from} bis ${to}`])
  totals.addRow([])
  totals.addRow(['Mitarbeiter', 'Stunden']).font = { bold: true }
  const summary = summarize(rows)
  for (const [name, total] of summary.employeeTotals) totals.addRow([name, Number((total / 60).toFixed(2))])
  totals.addRow([])
  totals.addRow(['Gesamtsumme', Number((summary.grandTotal / 60).toFixed(2))]).font = { bold: true }
  totals.columns = [{ width: 32 }, { width: 16 }]
  return workbook.xlsx.writeBuffer()
}

export default async function timesheetReports(request: Request, _context: Context) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung für Stundenzettel-Exporte.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const from = String(body.from || '')
  const to = String(body.to || '')
  const scope: Scope = body.scope === 'planned' ? 'planned' : 'actual'
  const format: Format = body.format === 'xlsx' ? 'xlsx' : 'pdf'
  const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).map((value) => value.trim()).filter(Boolean) : []
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return json({ message: 'Der Zeitraum ist ungültig.' }, 400)

  const [names, schedulesRaw] = await Promise.all([loadNames(request), loadSchedules(request, from, to)])
  const schedules = userIds.length ? schedulesRaw.filter((entry) => userIds.includes(String(entry.employeeUserId || ''))) : schedulesRaw
  let rows: ReportRow[] = []

  if (scope === 'planned') {
    rows = buildPlannedRows(schedules, names)
  } else {
    const connection = databaseConnectionString()
    if (!connection) return json({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.' }, 503)
    try {
      const { neon } = await import('@neondatabase/serverless')
      const sql = neon(connection)
      const placeholders = userIds.map((_, index) => `$${index + 4}`).join(', ')
      const filter = userIds.length ? ` AND e.user_id IN (${placeholders})` : ''
      const events = await sql.query(
        `SELECT e.id, e.user_id, e.action, e.client_occurred_at, e.event_date,
                e.schedule_id, e.object_id, e.location_status, e.offline_captured,
                a.pause_minutes AS pause_minutes_adjustment
           FROM attendance_events e
           LEFT JOIN LATERAL (
             SELECT adjustment.pause_minutes
               FROM attendance_adjustments adjustment
              WHERE adjustment.event_id = e.id
              ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
           ) a ON true
          WHERE e.event_date BETWEEN $1::date AND $2::date${filter}
          ORDER BY e.user_id, e.client_occurred_at, e.id`,
        [from, addDays(to, 1), ...userIds],
      ) as AttendanceEvent[]
      rows = buildActualRows(events, schedules, names, from, to)
    } catch (error) {
      console.error('Habun timesheet report query', error)
      return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.' }, 500)
    }
  }

  if (!rows.length) return json({ message: 'Für den ausgewählten Zeitraum wurden keine Daten gefunden.', code: 'NO_DATA' }, 404)

  try {
    const bytes = format === 'xlsx' ? await buildExcel(rows, from, to, scope) : await buildPdf(request, rows, from, to, scope)
    const basename = scope === 'planned' ? `Habun-Dienstplanstunden-${from}-bis-${to}` : `Habun-Stundenzettel-${from}-bis-${to}`
    if (format === 'xlsx') {
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${basename}.xlsx"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex',
        },
      })
    }
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${basename}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('Habun timesheet report render', error)
    return json({ message: 'Die Stundenzettel-Datei konnte nicht erzeugt werden.' }, 500)
  }
}

export const config: Config = { path: '/api/timesheet-reports' }
