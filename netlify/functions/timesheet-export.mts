import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings } from './_shared/company-settings.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

type Format = 'pdf' | 'xlsx'
type Source = 'actual' | 'planned'
type ScheduleEntry = {
  id?: string
  employeeUserId?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  pauseMinutes?: number
  objectId?: string | null
  location?: string
  workArea?: string
  status?: string
}
type AttendanceEvent = {
  id: string
  user_id: string
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  schedule_id: string | null
  object_id: string | null
  pause_minutes_adjustment: number | null
}
type ReportRow = {
  employeeUserId: string
  employeeName: string
  date: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  workArea: string
  source: Source
  scheduleId: string | null
}

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])
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

function text(value: unknown, maximum = 100) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safePdfText(value: unknown, maximum = 100) {
  return text(value, maximum)
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
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

function durationText(minutes: number) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function decimalHours(minutes: number) {
  return Number((Math.max(0, Number(minutes) || 0) / 60).toFixed(2))
}

function germanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) : value
}

function monthLabel(from: string, to: string) {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const date = new Date(`${from.slice(0, 7)}-15T12:00:00`)
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date)
  }
  return `${germanDate(from)} bis ${germanDate(to)}`
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

async function loadSchedules(request: Request, from: string, to: string, userIds: string[]) {
  const payload = await fetchJson(request, `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) as { entries?: ScheduleEntry[] }
  let entries = Array.isArray(payload.entries) ? payload.entries.filter((entry) => entry.status !== 'draft') : []
  if (userIds.length) entries = entries.filter((entry) => userIds.includes(String(entry.employeeUserId || '')))
  return entries
}

function buildPlannedRows(schedules: ScheduleEntry[], names: Map<string, string>): ReportRow[] {
  return schedules.map((entry) => {
    const employeeUserId = String(entry.employeeUserId || '')
    const pauseMinutes = Math.max(0, Math.round(Number(entry.pauseMinutes) || 0))
    return {
      employeeUserId,
      employeeName: text(entry.employeeName) || names.get(employeeUserId) || 'Mitarbeiter',
      date: text(entry.date, 10),
      start: text(entry.start, 5) || '–',
      end: text(entry.end, 5) || '–',
      pauseMinutes,
      netMinutes: plannedMinutes(text(entry.date, 10), text(entry.start, 5), text(entry.end, 5), pauseMinutes),
      location: text(entry.location, 80) || '–',
      workArea: text(entry.workArea, 80) || '–',
      source: 'planned' as const,
      scheduleId: String(entry.id || '').trim() || null,
    }
  })
}

function buildActualRows(events: AttendanceEvent[], schedules: ScheduleEntry[], names: Map<string, string>, from: string, to: string): ReportRow[] {
  const scheduleById = new Map(schedules.map((entry) => [String(entry.id || ''), entry]))
  const currentByUser = new Map<string, { start: AttendanceEvent; breakStart: AttendanceEvent | null; breakMinutes: number }>()
  const rows: ReportRow[] = []
  const ordered = [...events].sort((left, right) => {
    const byUser = String(left.user_id || '').localeCompare(String(right.user_id || ''))
    if (byUser) return byUser
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
        ? Math.max(0, Math.round(Number(event.pause_minutes_adjustment) || 0))
        : current.breakMinutes
      const gross = Math.max(0, Math.round((new Date(event.client_occurred_at).getTime() - new Date(current.start.client_occurred_at).getTime()) / 60000))
      const scheduleId = String(current.start.schedule_id || event.schedule_id || '').trim() || null
      const shift = scheduleId ? scheduleById.get(scheduleId) : undefined
      rows.push({
        employeeUserId: userId,
        employeeName: names.get(userId) || text(shift?.employeeName) || 'Mitarbeiter',
        date: startDate,
        start: timeOnly(current.start.client_occurred_at),
        end: timeOnly(event.client_occurred_at),
        pauseMinutes,
        netMinutes: Math.max(0, gross - pauseMinutes),
        location: text(shift?.location || current.start.object_id || event.object_id, 80) || '–',
        workArea: text(shift?.workArea, 80) || '–',
        source: 'actual',
        scheduleId,
      })
    }
    currentByUser.delete(userId)
  }
  return rows
}

function mergeRows(actualRows: ReportRow[], plannedRows: ReportRow[]) {
  const planned = [...plannedRows]
  const used = new Set<number>()
  const byScheduleId = new Map(planned.map((row, index) => [row.scheduleId || '', { row, index }]).filter(([id]) => id))
  const merged: ReportRow[] = []

  for (const actual of actualRows) {
    let match: ReportRow | null = null
    let index = -1
    const direct = actual.scheduleId ? byScheduleId.get(actual.scheduleId) : null
    if (direct && !used.has(direct.index)) {
      match = direct.row
      index = direct.index
    } else {
      const candidates = planned.map((row, candidateIndex) => ({ row, candidateIndex })).filter(({ row, candidateIndex }) =>
        !used.has(candidateIndex) && row.employeeUserId === actual.employeeUserId && row.date === actual.date,
      )
      if (candidates.length === 1) {
        match = candidates[0].row
        index = candidates[0].candidateIndex
      } else {
        const exact = candidates.find(({ row }) => row.start === actual.start)
        if (exact) {
          match = exact.row
          index = exact.candidateIndex
        }
      }
    }
    if (index >= 0) used.add(index)
    merged.push({
      ...match,
      ...actual,
      employeeName: actual.employeeName || match?.employeeName || 'Mitarbeiter',
      location: actual.location !== '–' ? actual.location : match?.location || '–',
      workArea: actual.workArea !== '–' ? actual.workArea : match?.workArea || '–',
      source: 'actual',
    })
  }

  planned.forEach((row, index) => {
    if (!used.has(index)) merged.push({ ...row, source: 'planned' })
  })
  return merged.sort((left, right) => `${left.employeeName}-${left.date}-${left.start}`.localeCompare(`${right.employeeName}-${right.date}-${right.start}`, 'de'))
}

async function loadActualRows(from: string, to: string, userIds: string[], schedules: ScheduleEntry[], names: Map<string, string>) {
  const connection = databaseConnectionString()
  if (!connection) return [] as ReportRow[]
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(connection)
    const placeholders = userIds.map((_, index) => `$${index + 3}`).join(', ')
    const filter = userIds.length ? ` AND e.user_id IN (${placeholders})` : ''
    const events = await sql.query(
      `SELECT e.id, e.user_id, e.action, e.client_occurred_at, e.event_date,
              e.schedule_id, e.object_id, a.pause_minutes AS pause_minutes_adjustment
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
    return buildActualRows(events, schedules, names, from, to)
  } catch (error) {
    console.error('Habun unified timesheet attendance query', error)
    return [] as ReportRow[]
  }
}

function groupRows(rows: ReportRow[]) {
  const groups = new Map<string, ReportRow[]>()
  for (const row of rows) {
    const key = `${row.employeeUserId}|${row.employeeName}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(row)
  }
  return [...groups.values()].sort((a, b) => (a[0]?.employeeName || '').localeCompare(b[0]?.employeeName || '', 'de'))
}

async function embedLogo(pdf: any, request: Request, logoUrl: string) {
  try {
    const response = await fetch(new URL(logoUrl || '/habun-logo.png', request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return response.headers.get('content-type')?.includes('jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  } catch {
    return null
  }
}

async function buildPdf(request: Request, rows: ReportRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedLogo(pdf, request, settings.logoUrl)
  const width = 595
  const height = 842
  const margin = 36
  const gold = rgb(0.86, 0.67, 0.22)
  const lightGray = rgb(0.96, 0.96, 0.96)
  const dark = rgb(0.08, 0.08, 0.08)
  const columns = [36, 105, 154, 203, 254, 310, 380]
  const groups = groupRows(rows)

  for (const employeeRows of groups) {
    const employeeName = employeeRows[0]?.employeeName || 'Mitarbeiter'
    let page: any = null
    let y = 0
    let pageNumber = 0

    const drawWatermark = () => {
      if (!logo) return
      const scale = Math.min(235 / logo.width, 180 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawImage(logo, {
        x: (width - logoWidth) / 2,
        y: (height - logoHeight) / 2 - 20,
        width: logoWidth,
        height: logoHeight,
        opacity: 0.07,
      })
    }

    const drawHeader = () => {
      page = pdf.addPage([width, height])
      pageNumber += 1
      drawWatermark()
      page.drawRectangle({ x: margin, y: height - 118, width: width - margin * 2, height: 72, borderWidth: 1, borderColor: dark })
      page.drawText('Arbeitszeitenbericht', { x: 207, y: height - 70, size: 15, font: bold, color: dark })
      page.drawText(safePdfText(monthLabel(from, to), 50), { x: 226, y: height - 91, size: 11, font: bold, color: dark })
      page.drawText(`Arbeitnehmer: ${safePdfText(employeeName, 48)}`, { x: margin + 8, y: height - 110, size: 10.5, font: bold, color: dark })
      if (pageNumber > 1) page.drawText(`Fortsetzung ${pageNumber}`, { x: width - 112, y: height - 110, size: 7.5, font: regular, color: dark })

      y = height - 146
      page.drawRectangle({ x: margin, y: y - 22, width: width - margin * 2, height: 24, color: gold, borderWidth: 1, borderColor: dark })
      const headers = ['Datum', 'Startzeit', 'Endzeit', 'Pause', 'Dauer', 'Status', 'Tätigkeit']
      headers.forEach((header, index) => page.drawText(safePdfText(header), { x: columns[index] + 3, y: y - 14, size: 8, font: bold, color: dark }))
      y -= 22
    }

    drawHeader()
    for (let index = 0; index < employeeRows.length; index += 1) {
      const row = employeeRows[index]
      if (y < 155) drawHeader()
      const rowHeight = 17
      if (index % 2 === 1) page.drawRectangle({ x: margin, y: y - rowHeight, width: width - margin * 2, height: rowHeight, color: lightGray })
      page.drawRectangle({ x: margin, y: y - rowHeight, width: width - margin * 2, height: rowHeight, borderWidth: 0.35, borderColor: rgb(0.4, 0.4, 0.4) })
      const values = [
        germanDate(row.date), row.start || '–', row.end || '–', `${row.pauseMinutes} Min.`, durationText(row.netMinutes),
        row.source === 'actual' ? 'Erfasst' : 'Dienstplan', row.workArea || row.location || '–',
      ]
      values.forEach((value, valueIndex) => page.drawText(safePdfText(value, valueIndex === 6 ? 28 : 16), { x: columns[valueIndex] + 3, y: y - 12, size: 7.2, font: regular, color: dark }))
      y -= rowHeight
    }

    const total = employeeRows.reduce((sum, row) => sum + Math.max(0, Number(row.netMinutes) || 0), 0)
    if (y < 125) drawHeader()
    y -= 12
    page.drawRectangle({ x: margin, y: y - 22, width: 335, height: 24, color: gold, borderWidth: 1, borderColor: dark })
    page.drawRectangle({ x: margin + 335, y: y - 22, width: 92, height: 24, color: gold, borderWidth: 1, borderColor: dark })
    page.drawText('Gesamtdauer', { x: margin + 4, y: y - 15, size: 10, font: bold, color: dark })
    page.drawText(`${durationText(total)} Std.`, { x: margin + 344, y: y - 15, size: 10, font: bold, color: dark })
    y -= 42
    page.drawRectangle({ x: margin, y: y - 62, width: width - margin * 2, height: 64, borderWidth: 1, borderColor: dark })
    page.drawText('Anmerkungen', { x: margin + 5, y: y - 14, size: 9, font: regular, color: dark })
    page.drawText(safePdfText(settings.companyName || 'Habun Security', 50), { x: margin, y: 24, size: 6.5, font: regular, color: rgb(0.35, 0.35, 0.35) })
  }
  return pdf.save()
}

async function buildExcel(rows: ReportRow[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const settings = await readCompanySettings()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = settings.companyName || 'Habun Security'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Stundenzettel', { views: [{ state: 'frozen', ySplit: 6 }] })
  sheet.addRow([settings.companyName || 'Habun Security'])
  sheet.addRow(['Arbeitszeitenbericht', monthLabel(from, to)])
  sheet.addRow([`Zeitraum ${germanDate(from)} bis ${germanDate(to)}`])
  sheet.addRow([])
  sheet.addRow(['Mitarbeiter', 'Datum', 'Startzeit', 'Endzeit', 'Pause Min.', 'Dauer Std.', 'Status', 'Einsatzort', 'Arbeitsbereich'])
  const header = sheet.getRow(5)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCAF38' } }
  for (const row of rows) {
    sheet.addRow([
      row.employeeName, row.date, row.start, row.end, row.pauseMinutes, decimalHours(row.netMinutes),
      row.source === 'actual' ? 'Erfasst' : 'Dienstplan', row.location, row.workArea,
    ])
  }
  sheet.columns = [{ width: 28 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 14 }, { width: 28 }, { width: 28 }]

  const totals = workbook.addWorksheet('Gesamtdauer')
  totals.addRow(['Mitarbeiter', 'Gesamtdauer Std.']).font = { bold: true }
  for (const group of groupRows(rows)) {
    totals.addRow([group[0]?.employeeName || 'Mitarbeiter', decimalHours(group.reduce((sum, row) => sum + row.netMinutes, 0))])
  }
  totals.columns = [{ width: 32 }, { width: 20 }]
  return workbook.xlsx.writeBuffer()
}

function filenamePart(value: string) {
  return text(value, 50).replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '-').replace(/^-+|-+$/g, '') || 'Mitarbeiter'
}

export default async function timesheetExport(request: Request, _context: Context) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung für Stundenzettel-Exporte.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const from = String(body.from || '')
  const to = String(body.to || '')
  const format: Format = body.format === 'xlsx' ? 'xlsx' : 'pdf'
  const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).map((value) => value.trim()).filter(Boolean) : []
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return json({ message: 'Der Zeitraum ist ungültig.' }, 400)

  const [names, schedules] = await Promise.all([loadNames(request), loadSchedules(request, from, to, userIds)])
  const plannedRows = buildPlannedRows(schedules, names)
  const actualRows = await loadActualRows(from, to, userIds, schedules, names)
  let rows = mergeRows(actualRows, plannedRows)
  if (userIds.length) rows = rows.filter((row) => userIds.includes(row.employeeUserId))
  if (!rows.length) return json({ message: 'Für den ausgewählten Zeitraum wurden keine Stundenzettel-Daten gefunden.', code: 'NO_DATA' }, 404)

  try {
    const bytes = format === 'xlsx' ? await buildExcel(rows, from, to) : await buildPdf(request, rows, from, to)
    const groups = groupRows(rows)
    const employeePart = groups.length === 1 ? `-${filenamePart(groups[0][0]?.employeeName || 'Mitarbeiter')}` : ''
    const basename = `Habun-Stundenzettel${employeePart}-${from}-bis-${to}`
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
    console.error('Habun unified timesheet export', error)
    return json({ message: 'Die Stundenzettel-Datei konnte nicht erzeugt werden.' }, 500)
  }
}

export const config: Config = { path: '/api/timesheet-export' }
