import type { Config } from '@netlify/functions'
import { requirePortalRole } from './_shared/portal-role.mts'
import { readCompanySettings } from './_shared/company-settings.mts'
import { listTimesheetEntries, type TimesheetEntry } from './_shared/timesheet-repository.mts'
import { syncPublishedScheduleRange } from './_shared/timesheet-schedule-sync.mts'
import { monthKeyForDate } from './_shared/timesheet-month-policy.mts'
import { pauseDisplay, rollupDailyTimesheetRows } from '../../shared/timesheet-daily-rollup.mjs'

const MANAGEMENT = ['owner', 'admin', 'manager'] as const
type Format = 'pdf' | 'xlsx'
type DailyTimesheetRow = {
  id: string
  employeeUserId: string
  employeeName: string
  workDate: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  entries: TimesheetEntry[]
  entryCount: number
}
type DisplayRow = DailyTimesheetRow | null

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}
function text(value: unknown, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}
function safePdfText(value: unknown, max = 160) {
  return text(value, max).replace(/–/g, '-').replace(/—/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}
function validateRange(from: string, to: string) {
  try { monthKeyForDate(from); monthKeyForDate(to) } catch { return false }
  if (to < from) return false
  const start = new Date(`${from}T12:00:00Z`).getTime()
  const end = new Date(`${to}T12:00:00Z`).getTime()
  return Number.isFinite(start) && Number.isFinite(end) && (end - start) / 86400000 <= 370
}
function germanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) : value
}
function shortGermanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)
    : value
}
function isWeekend(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}
function monthLabel(from: string, to: string) {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const date = new Date(`${from.slice(0, 7)}-15T12:00:00`)
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date)
  }
  return `${germanDate(from)} - ${germanDate(to)}`
}
function durationText(minutes: number) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
function groupRows(rows: DailyTimesheetRow[]) {
  const groups = new Map<string, DailyTimesheetRow[]>()
  for (const row of rows) {
    const key = row.employeeUserId ? `id:${row.employeeUserId}` : `unregistered:${row.employeeName}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(row)
  }
  return [...groups.values()].sort((a, b) => (a[0]?.employeeName || '').localeCompare(b[0]?.employeeName || '', 'de'))
}
function dateRange(from: string, to: string) {
  const dates: string[] = []
  let cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 86400000)
  }
  return dates
}
function rowsWithBlankDates(rows: DailyTimesheetRow[], from: string, to: string): Array<{ date: string; row: DisplayRow }> {
  const byDate = new Map<string, DailyTimesheetRow[]>()
  for (const row of rows) {
    if (!byDate.has(row.workDate)) byDate.set(row.workDate, [])
    byDate.get(row.workDate)?.push(row)
  }
  const result: Array<{ date: string; row: DisplayRow }> = []
  for (const date of dateRange(from, to)) {
    const dayRows = (byDate.get(date) || []).sort((a, b) => `${a.start}-${a.id}`.localeCompare(`${b.start}-${b.id}`))
    if (dayRows.length === 0) result.push({ date, row: null })
    else dayRows.forEach((row) => result.push({ date, row }))
  }
  return result
}
async function embedLogo(pdf: any, request: Request, logoUrl: string) {
  try {
    const response = await fetch(new URL(logoUrl || '/habun-logo.png', request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return response.headers.get('content-type')?.includes('jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  } catch { return null }
}
async function buildPdf(request: Request, rows: DailyTimesheetRow[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedLogo(pdf, request, settings.logoUrl)
  const groups = groupRows(rows)
  const width = 595, height = 842, margin = 12
  const dark = rgb(0.08, 0.08, 0.08)
  const line = rgb(0.32, 0.32, 0.32)
  const white = rgb(1, 1, 1)
  const weekend = rgb(0.89, 0.89, 0.89)
  const headerGreen = rgb(0.49, 0.67, 0.31)
  const totalOrange = rgb(0.91, 0.52, 0.24)
  const tableWidth = width - margin * 2
  const columns = [12, 139, 247, 355, 463, 583]
  const headers = ['Datum', 'Startzeit', 'Endzeit', 'Pause', 'Arbeitsstunden']

  for (const employeeRows of groups.length ? groups : [[] as DailyTimesheetRow[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Keine Einträge'
    const displayRows = rowsWithBlankDates(employeeRows, from, to)
    let page: any
    let y = 0
    let pageNo = 0

    const drawWatermark = () => {
      if (!logo) return
      const scale = Math.min(205 / logo.width, 170 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawImage(logo, {
        x: (width - logoWidth) / 2,
        y: 285,
        width: logoWidth,
        height: logoHeight,
        opacity: 0.06,
      })
    }

    const drawFooter = () => {
      const companyLine = [settings.companyName, settings.address, settings.phone, settings.email].filter(Boolean).join(' · ')
      page.drawText(safePdfText(companyLine, 150), { x: margin, y: 22, size: 6.5, font: regular, color: rgb(0.35, 0.35, 0.35) })
    }

    const drawHeader = () => {
      page = pdf.addPage([width, height])
      pageNo += 1
      drawWatermark()
      page.drawRectangle({ x: margin, y: height - 82, width: tableWidth, height: 68, borderColor: line, borderWidth: 1 })
      page.drawText('Stundenzettel', { x: 225, y: height - 38, size: 15, font: bold, color: dark })
      const period = monthLabel(from, to)
      page.drawText(safePdfText(period, 70), { x: Math.max(margin + 10, (width - regular.widthOfTextAtSize(safePdfText(period), 10)) / 2), y: height - 56, size: 10, font: bold, color: dark })
      page.drawText(`Arbeitnehmer: ${safePdfText(employeeName, 70)}`, { x: margin + 8, y: height - 72, size: 9.5, font: bold, color: dark })
      if (pageNo > 1) page.drawText(`Seite ${pageNo}`, { x: width - 62, y: height - 72, size: 7, font: regular, color: dark })
      y = height - 112
      page.drawRectangle({ x: margin, y: y - 20, width: tableWidth, height: 22, color: headerGreen, borderColor: line, borderWidth: 0.7 })
      headers.forEach((header, index) => page.drawText(header, { x: columns[index] + 3, y: y - 13, size: 6.8, font: bold, color: dark }))
      y -= 20
      drawFooter()
    }

    drawHeader()
    for (const item of displayRows) {
      if (y < 150) drawHeader()
      const rowHeight = 17
      const row = item.row
      const values = [
        shortGermanDate(item.date),
        row?.start || '',
        row?.end || '',
        row ? pauseDisplay(row.pauseMinutes) : '',
        row ? durationText(row.netMinutes) : '',
      ]
      page.drawRectangle({ x: margin, y: y - rowHeight, width: tableWidth, height: rowHeight, color: isWeekend(item.date) ? weekend : white, borderColor: line, borderWidth: 0.35 })
      values.forEach((value, index) => page.drawText(safePdfText(value), { x: columns[index] + 3, y: y - 11, size: 7, font: regular, color: dark }))
      y -= rowHeight
    }

    const total = employeeRows.reduce((sum, row) => sum + Math.max(0, Number(row.netMinutes) || 0), 0)
    if (y < 128) drawHeader()
    y -= 12
    page.drawRectangle({ x: margin, y: y - 24, width: 470, height: 24, color: totalOrange, borderColor: line, borderWidth: 0.8 })
    page.drawText('Gesamtdauer', { x: margin + 7, y: y - 16, size: 9, font: bold, color: dark })
    page.drawRectangle({ x: 376, y: y - 24, width: 106, height: 24, borderColor: line, borderWidth: 0.8 })
    page.drawText(`${durationText(total)} Std.`, { x: 386, y: y - 16, size: 9, font: bold, color: dark })
    y -= 45
    page.drawRectangle({ x: margin, y: y - 66, width: tableWidth, height: 66, borderColor: line, borderWidth: 0.8 })
    page.drawText('Platz für weitere Anmerkungen...', { x: margin + 7, y: y - 13, size: 8, font: regular, color: dark })
  }
  return new Uint8Array(await pdf.save())
}
function safeSheetName(value: string, used: Set<string>) {
  const base = (value || 'Stundenzettel').replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'Stundenzettel'
  let name = base, suffix = 2
  while (used.has(name)) { const tail = ` ${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}` }
  used.add(name); return name
}
async function buildXlsx(rows: DailyTimesheetRow[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const settings = await readCompanySettings()
  workbook.creator = settings.companyName
  workbook.created = new Date()
  const used = new Set<string>()
  const groups = groupRows(rows)
  for (const employeeRows of groups.length ? groups : [[] as DailyTimesheetRow[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Stundenzettel'
    const sheet = workbook.addWorksheet(safeSheetName(employeeName, used))
    sheet.addRow([settings.companyName]); sheet.addRow(['Stundenzettel', employeeName]); sheet.addRow(['Zeitraum', `${germanDate(from)} - ${germanDate(to)}`]); sheet.addRow([])
    sheet.addRow(['Datum', 'Beginn', 'Ende', 'Pause', 'Arbeitsstunden'])
    for (const row of employeeRows) sheet.addRow([germanDate(row.workDate), row.start, row.end, pauseDisplay(row.pauseMinutes), durationText(row.netMinutes)])
    const total = employeeRows.reduce((sum, row) => sum + row.netMinutes, 0)
    sheet.addRow([]); sheet.addRow(['Gesamt', '', '', '', durationText(total)])
    sheet.columns = [{ width: 16 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 18 }]
    sheet.getRow(5).font = { bold: true }; sheet.getRow(2).font = { bold: true, size: 14 }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
export default async function timesheetMonthlyReports(request: Request) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  const access = await requirePortalRole([...MANAGEMENT])
  if (access.response || !access.current) return access.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const from = text(body.from, 10), to = text(body.to, 10), format = text(body.format, 8) as Format
  if (!validateRange(from, to) || !['pdf', 'xlsx'].includes(format)) return json({ message: 'Zeitraum oder Format ist ungültig.' }, 400)
  const userIds = Array.isArray(body.userIds) ? body.userIds.map((value) => text(value, 120)).filter(Boolean) : []
  try {
    await syncPublishedScheduleRange(from, to, access.current.userId, new Date())
    let sourceRows = await listTimesheetEntries({ from, to, ...(userIds.length === 1 ? { employeeUserId: userIds[0] } : {}) })
    if (userIds.length > 1) { const allowed = new Set(userIds); sourceRows = sourceRows.filter((row) => allowed.has(row.employeeUserId)) }
    const rows = rollupDailyTimesheetRows(sourceRows) as DailyTimesheetRow[]
    const bytes = format === 'pdf' ? await buildPdf(request, rows, from, to) : await buildXlsx(rows, from, to)
    const filename = `Habun-Stundenzettel-${from}-bis-${to}.${format}`
    const contentType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return new Response(bytes, { status: 200, headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
  } catch (error) {
    console.error('independent timesheet report failed', error)
    return json({ message: 'Stundenzettel-Datei konnte nicht erstellt werden.' }, 500)
  }
}
export const config: Config = { path: '/api/timesheet-monthly-reports' }
