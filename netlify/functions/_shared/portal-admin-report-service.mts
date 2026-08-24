import { getDatabase } from '@netlify/database'
import { databaseConnectionString } from './database-connection.mts'
import { readCompanySettings } from './company-settings.mts'
import { readPdfLogoBytes } from './pdf-branding.mts'
import { loadOriginalLogo } from './pdf-shield-logo.mts'
import { listScheduleShifts, type ScheduleShift } from './schedule-neon-repository.mts'

export type PortalAdminExportFormat = 'pdf' | 'xlsx'
export type PortalAdminTimesheetScope = 'unified' | 'actual' | 'planned'

export class PortalAdminReportError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'REPORT_ERROR', status = 400) {
    super(message)
    this.name = 'PortalAdminReportError'
    this.code = code
    this.status = status
  }
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
  source: 'actual' | 'planned'
  scheduleId: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function pdfText(value: unknown, max = 160) {
  return text(value, max)
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function normalizeRange(input: Record<string, unknown>) {
  const from = text(input.from, 10)
  const to = text(input.to, 10)
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) {
    throw new PortalAdminReportError('Der Zeitraum ist ungültig.', 'INVALID_RANGE', 400)
  }
  return { from, to }
}

function normalizeUserIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, 200)).filter(Boolean))].slice(0, 200)
    : []
}

function normalizeFormat(value: unknown): PortalAdminExportFormat {
  return value === 'xlsx' ? 'xlsx' : 'pdf'
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function dateOnly(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
}

function berlinTime(value: unknown) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function clockMinutes(value: string) {
  const [hours, minutes] = String(value || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

function plannedMinutes(date: string, start: string, end: string, pauseMinutes: number) {
  if (!date || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0
  const startMinutes = clockMinutes(start)
  const endMinutesRaw = clockMinutes(end)
  if (startMinutes === null || endMinutesRaw === null) return 0
  const endMinutes = endMinutesRaw <= startMinutes ? endMinutesRaw + 24 * 60 : endMinutesRaw
  return Math.max(0, endMinutes - startMinutes - Math.max(0, Math.round(pauseMinutes)))
}

function decimalHours(minutes: number) {
  return Number((Math.max(0, minutes) / 60).toFixed(2))
}

function durationText(minutes: number) {
  const total = Math.max(0, Math.round(minutes))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

async function loadNames() {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT user_id, full_name FROM schedule_employees ORDER BY lower(full_name), user_id`,
  )
  return new Map(result.rows.map((row) => [String(row.user_id || ''), text(row.full_name) || 'Mitarbeiter']))
}

async function loadSchedules(from: string, to: string, userIds: string[]) {
  let rows = await listScheduleShifts({ from, to })
  rows = rows.filter((row) => row.status === 'published')
  if (userIds.length) rows = rows.filter((row) => userIds.includes(row.employeeUserId))
  return rows
}

function plannedRows(schedules: ScheduleShift[], names: Map<string, string>): ReportRow[] {
  return schedules.map((entry) => ({
    employeeUserId: entry.employeeUserId,
    employeeName: text(entry.employeeName) || names.get(entry.employeeUserId) || 'Mitarbeiter',
    date: entry.date,
    start: entry.start,
    end: entry.end,
    pauseMinutes: Math.max(0, Math.round(Number(entry.pauseMinutes) || 0)),
    netMinutes: plannedMinutes(entry.date, entry.start, entry.end, entry.pauseMinutes),
    location: text(entry.location, 120) || '-',
    workArea: text(entry.workArea, 120) || '-',
    source: 'planned',
    scheduleId: entry.id,
  }))
}

async function loadAttendanceEvents(from: string, to: string, userIds: string[]) {
  const connection = databaseConnectionString()
  if (!connection) return [] as AttendanceEvent[]
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(connection)
  const placeholders = userIds.map((_, index) => `$${index + 3}`).join(', ')
  const filter = userIds.length ? ` AND e.user_id IN (${placeholders})` : ''
  return await sql.query(
    `SELECT e.id, e.user_id, e.action, e.client_occurred_at, e.event_date,
            e.schedule_id, e.object_id, a.pause_minutes AS pause_minutes_adjustment
       FROM attendance_events e
       LEFT JOIN LATERAL (
         SELECT adjustment.pause_minutes
           FROM attendance_adjustments adjustment
          WHERE adjustment.event_id = e.id
          ORDER BY adjustment.occurred_at DESC, adjustment.id DESC
          LIMIT 1
       ) a ON true
      WHERE e.event_date BETWEEN $1::date AND $2::date${filter}
      ORDER BY e.user_id, e.client_occurred_at, e.id`,
    [from, addDays(to, 1), ...userIds],
  ) as AttendanceEvent[]
}

function actualRows(
  events: AttendanceEvent[],
  schedules: ScheduleShift[],
  names: Map<string, string>,
  from: string,
  to: string,
): ReportRow[] {
  const scheduleById = new Map(schedules.map((entry) => [entry.id, entry]))
  const currentByUser = new Map<string, {
    start: AttendanceEvent
    breakStart: AttendanceEvent | null
    breakMinutes: number
  }>()
  const rows: ReportRow[] = []

  for (const event of events) {
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
      current.breakMinutes += Math.max(0, Math.round(
        (new Date(event.client_occurred_at).getTime() - new Date(current.breakStart.client_occurred_at).getTime()) / 60000,
      ))
      current.breakStart = null
      continue
    }
    if (event.action !== 'clock-out') continue

    const date = dateOnly(current.start.event_date)
    if (date >= from && date <= to) {
      const pauseMinutes = event.pause_minutes_adjustment !== null && event.pause_minutes_adjustment !== undefined
        ? Math.max(0, Math.round(Number(event.pause_minutes_adjustment) || 0))
        : current.breakMinutes
      const grossMinutes = Math.max(0, Math.round(
        (new Date(event.client_occurred_at).getTime() - new Date(current.start.client_occurred_at).getTime()) / 60000,
      ))
      const scheduleId = String(current.start.schedule_id || event.schedule_id || '').trim() || null
      const shift = scheduleId ? scheduleById.get(scheduleId) : undefined
      rows.push({
        employeeUserId: userId,
        employeeName: names.get(userId) || text(shift?.employeeName) || 'Mitarbeiter',
        date,
        start: berlinTime(current.start.client_occurred_at),
        end: berlinTime(event.client_occurred_at),
        pauseMinutes,
        netMinutes: Math.max(0, grossMinutes - pauseMinutes),
        location: text(shift?.location || current.start.object_id || event.object_id, 120) || '-',
        workArea: text(shift?.workArea, 120) || '-',
        source: 'actual',
        scheduleId,
      })
    }
    currentByUser.delete(userId)
  }
  return rows
}

function mergeRows(actual: ReportRow[], planned: ReportRow[]) {
  const unused = planned.map((row, index) => ({ row, index }))
  const used = new Set<number>()
  const merged: ReportRow[] = []
  for (const row of actual) {
    let match = unused.find(({ row: candidate, index }) => !used.has(index) && row.scheduleId && candidate.scheduleId === row.scheduleId)
    if (!match) {
      const candidates = unused.filter(({ row: candidate, index }) => !used.has(index) && candidate.employeeUserId === row.employeeUserId && candidate.date === row.date)
      match = candidates.find(({ row: candidate }) => candidate.start === row.start) || (candidates.length === 1 ? candidates[0] : undefined)
    }
    if (match) used.add(match.index)
    merged.push({
      ...(match?.row || {} as ReportRow),
      ...row,
      employeeName: row.employeeName || match?.row.employeeName || 'Mitarbeiter',
      location: row.location !== '-' ? row.location : match?.row.location || '-',
      workArea: row.workArea !== '-' ? row.workArea : match?.row.workArea || '-',
      scheduleId: row.scheduleId || match?.row.scheduleId || null,
      source: 'actual',
    })
  }
  unused.forEach(({ row, index }) => { if (!used.has(index)) merged.push(row) })
  return merged.sort((left, right) => `${left.employeeName}-${left.date}-${left.start}`.localeCompare(`${right.employeeName}-${right.date}-${right.start}`, 'de'))
}

function groupRows(rows: ReportRow[]) {
  const groups = new Map<string, ReportRow[]>()
  for (const row of rows) {
    const key = `${row.employeeUserId}|${row.employeeName}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return [...groups.values()].sort((left, right) => (left[0]?.employeeName || '').localeCompare(right[0]?.employeeName || '', 'de'))
}

async function timesheetPdf(rows: ReportRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf)
  const width = 595
  const height = 842
  const margin = 34
  const headers = ['Datum', 'Beginn', 'Ende', 'Pause', 'Std.', 'Bereich / Einsatzort']
  const columns = [margin, 108, 164, 220, 280, 335]

  for (const group of groupRows(rows)) {
    let page = pdf.addPage([width, height])
    let y = height - 155
    const employeeName = group[0]?.employeeName || 'Mitarbeiter'
    const newPage = () => {
      page = pdf.addPage([width, height])
      y = height - 155
    }
    const drawHeader = () => {
      if (logo) {
        const scale = Math.min(72 / logo.width, 72 / logo.height)
        page.drawImage(logo, { x: (width - logo.width * scale) / 2, y: height - 90, width: logo.width * scale, height: logo.height * scale })
      }
      page.drawText(pdfText(settings.companyName || 'Habun Security', 80), { x: margin, y: height - 108, size: 10, font: bold })
      page.drawText('Stundenzettel', { x: margin, y: height - 126, size: 15, font: bold })
      page.drawText(pdfText(`${employeeName} | ${from} bis ${to}`, 100), { x: margin, y: height - 142, size: 8.5, font: regular })
      headers.forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 7.5, font: bold }))
      y -= 10
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) })
      y -= 14
    }
    drawHeader()
    for (const row of group) {
      if (y < 72) {
        newPage()
        drawHeader()
      }
      const activity = row.workArea !== '-' ? `${row.workArea} / ${row.location}` : row.location
      const values = [row.date, row.start, row.end, `${row.pauseMinutes}`, `${decimalHours(row.netMinutes)}`, pdfText(activity, 46)]
      values.forEach((value, index) => page.drawText(String(value), { x: columns[index], y, size: 7.2, font: regular }))
      y -= 16
    }
    const total = group.reduce((sum, row) => sum + row.netMinutes, 0)
    if (y < 70) {
      newPage()
      drawHeader()
    }
    page.drawText(`Gesamt: ${durationText(total)} Std.`, { x: margin, y: y - 6, size: 10, font: bold })
  }
  return new Uint8Array(await pdf.save())
}

async function timesheetExcel(rows: ReportRow[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const settings = await readCompanySettings()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = settings.companyName || 'Habun Security'
  const sheet = workbook.addWorksheet('Stundenzettel', { views: [{ state: 'frozen', ySplit: 5 }] })
  sheet.addRow([settings.companyName || 'Habun Security'])
  sheet.addRow([`Stundenzettel ${from} bis ${to}`])
  sheet.addRow([])
  sheet.addRow(['Mitarbeiter', 'Datum', 'Beginn', 'Ende', 'Pause Min.', 'Stunden', 'Status', 'Einsatzort', 'Arbeitsbereich'])
  sheet.getRow(4).font = { bold: true }
  for (const row of rows) {
    sheet.addRow([row.employeeName, row.date, row.start, row.end, row.pauseMinutes, decimalHours(row.netMinutes), row.source === 'actual' ? 'Erfasst' : 'Dienstplan', row.location, row.workArea])
  }
  sheet.columns = [{ width: 28 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 28 }, { width: 28 }]
  const totals = workbook.addWorksheet('Gesamtstunden')
  totals.addRow(['Mitarbeiter', 'Gesamtstunden']).font = { bold: true }
  for (const group of groupRows(rows)) totals.addRow([group[0]?.employeeName || 'Mitarbeiter', decimalHours(group.reduce((sum, row) => sum + row.netMinutes, 0))])
  const logo = await readPdfLogoBytes().catch(() => null)
  if (logo) {
    const imageId = workbook.addImage({ buffer: Buffer.from(logo.bytes), extension: 'png' })
    sheet.addImage(imageId, { tl: { col: 7.6, row: 0 }, ext: { width: 70, height: 70 } })
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

function exportFilename(prefix: string, from: string, to: string, format: PortalAdminExportFormat) {
  return `${prefix}-${from}-bis-${to}.${format}`
}

export async function generateTimesheetAdminExport(input: Record<string, unknown>) {
  const { from, to } = normalizeRange(input)
  const userIds = normalizeUserIds(input.userIds)
  const format = normalizeFormat(input.format)
  const requestedScope = text(input.scope, 20)
  const scope: PortalAdminTimesheetScope = requestedScope === 'actual' ? 'actual' : requestedScope === 'planned' ? 'planned' : 'unified'
  const [names, schedules] = await Promise.all([loadNames(), loadSchedules(from, to, userIds)])
  const planned = plannedRows(schedules, names)
  const events = await loadAttendanceEvents(from, to, userIds)
  const actual = actualRows(events, schedules, names, from, to)
  let rows = scope === 'planned' ? planned : scope === 'actual' ? actual : mergeRows(actual, planned)
  if (userIds.length) rows = rows.filter((row) => userIds.includes(row.employeeUserId))
  if (!rows.length) throw new PortalAdminReportError('Für den Zeitraum wurden keine Stundenzettel-Daten gefunden.', 'NO_DATA', 404)
  const bytes = format === 'xlsx' ? await timesheetExcel(rows, from, to) : await timesheetPdf(rows, from, to)
  return {
    bytes,
    filename: exportFilename('Habun-Stundenzettel', from, to, format),
    contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    rowCount: rows.length,
  }
}

async function schedulePdf(shifts: ScheduleShift[], from: string, to: string) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf)
  const width = 842
  const height = 595
  const margin = 32
  let page = pdf.addPage([width, height])
  let y = height - 120
  const columns = [margin, 115, 245, 315, 385, 470, 620]
  const drawHeader = () => {
    if (logo) {
      const scale = Math.min(64 / logo.width, 64 / logo.height)
      page.drawImage(logo, { x: width - margin - logo.width * scale, y: height - 82, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(pdfText(settings.companyName || 'Habun Security', 80), { x: margin, y: height - 58, size: 11, font: bold })
    page.drawText(`Dienstplan ${from} bis ${to}`, { x: margin, y: height - 78, size: 15, font: bold })
    ;['Datum', 'Mitarbeiter', 'Beginn', 'Ende', 'Pause', 'Bereich', 'Einsatzort'].forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 8, font: bold }))
    y -= 18
  }
  drawHeader()
  for (const shift of shifts) {
    if (y < 42) {
      page = pdf.addPage([width, height])
      y = height - 120
      drawHeader()
    }
    const values = [shift.date, pdfText(shift.employeeName, 28), shift.start, shift.end, `${shift.pauseMinutes}`, pdfText(shift.workArea, 26), pdfText(shift.location, 30)]
    values.forEach((value, index) => page.drawText(String(value), { x: columns[index], y, size: 7.5, font: regular }))
    y -= 16
  }
  return new Uint8Array(await pdf.save())
}

async function scheduleExcel(shifts: ScheduleShift[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const settings = await readCompanySettings()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Dienstplan')
  sheet.addRow([settings.companyName || 'Habun Security'])
  sheet.addRow([`Dienstplan ${from} bis ${to}`])
  sheet.addRow([])
  sheet.addRow(['Datum', 'Mitarbeiter', 'Beginn', 'Ende', 'Pause Min.', 'Bereich', 'Einsatzort', 'Status'])
  sheet.getRow(4).font = { bold: true }
  for (const shift of shifts) sheet.addRow([shift.date, shift.employeeName, shift.start, shift.end, shift.pauseMinutes, shift.workArea, shift.location, shift.status])
  sheet.columns = [{ width: 13 }, { width: 28 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 28 }, { width: 32 }, { width: 12 }]
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

export async function generateScheduleAdminExport(input: Record<string, unknown>) {
  const { from, to } = normalizeRange(input)
  const userIds = normalizeUserIds(input.userIds)
  const format = normalizeFormat(input.format)
  const includeDrafts = input.includeDrafts === true
  let shifts = await listScheduleShifts({ from, to })
  if (!includeDrafts) shifts = shifts.filter((shift) => shift.status === 'published')
  if (userIds.length) shifts = shifts.filter((shift) => userIds.includes(shift.employeeUserId))
  if (!shifts.length) throw new PortalAdminReportError('Für den Zeitraum wurden keine Dienstpläne gefunden.', 'NO_DATA', 404)
  const bytes = format === 'xlsx' ? await scheduleExcel(shifts, from, to) : await schedulePdf(shifts, from, to)
  return {
    bytes,
    filename: exportFilename('Habun-Dienstplan', from, to, format),
    contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    rowCount: shifts.length,
  }
}
