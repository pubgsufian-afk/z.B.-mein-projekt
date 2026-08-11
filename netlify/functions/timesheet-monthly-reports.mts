import type { Config } from '@netlify/functions'
import { requirePortalRole } from './_shared/portal-role.mts'
import { readCompanySettings } from './_shared/company-settings.mts'
import { listTimesheetEntries, type TimesheetEntry } from './_shared/timesheet-repository.mts'
import { syncPublishedScheduleRange } from './_shared/timesheet-schedule-sync.mts'
import { monthKeyForDate } from './_shared/timesheet-month-policy.mts'

const MANAGEMENT = ['owner', 'admin', 'manager'] as const
type Format = 'pdf' | 'xlsx'

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
function durationText(minutes: number) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
function groupRows(rows: TimesheetEntry[]) {
  const groups = new Map<string, TimesheetEntry[]>()
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
  } catch { return null }
}
async function buildPdf(request: Request, rows: TimesheetEntry[], from: string, to: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedLogo(pdf, request, settings.logoUrl)
  const groups = groupRows(rows)
  const width = 595, height = 842, margin = 34
  const dark = rgb(0.08, 0.08, 0.08), line = rgb(0.72, 0.72, 0.72), pale = rgb(0.96, 0.96, 0.96)
  const drawHeader = (page: any, employeeName: string, pageNo: number) => {
    if (logo) {
      const scale = Math.min(80 / logo.width, 48 / logo.height)
      page.drawImage(logo, { x: margin, y: height - 72, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(safePdfText(settings.companyName, 70), { x: 130, y: height - 48, size: 12, font: bold, color: dark })
    page.drawText('Stundenzettel', { x: 130, y: height - 66, size: 16, font: bold, color: dark })
    page.drawText(`Mitarbeiter: ${safePdfText(employeeName, 60)}`, { x: margin, y: height - 98, size: 10, font: bold, color: dark })
    page.drawText(`Zeitraum: ${germanDate(from)} - ${germanDate(to)}`, { x: margin, y: height - 113, size: 9, font: regular, color: dark })
    page.drawText(`Seite ${pageNo}`, { x: width - 80, y: height - 113, size: 8, font: regular, color: dark })
    return height - 138
  }
  const columns = [34, 101, 146, 191, 238, 289, 355, 561]
  const headers = ['Datum', 'Start', 'Ende', 'Pause', 'Dauer', 'Bereich', 'Einsatzort']
  for (const employeeRows of groups.length ? groups : [[] as TimesheetEntry[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Keine Einträge'
    let page = pdf.addPage([width, height]), pageNo = 1, y = drawHeader(page, employeeName, pageNo)
    const drawColumns = () => {
      page.drawRectangle({ x: margin, y: y - 20, width: width - margin * 2, height: 22, color: pale, borderColor: line, borderWidth: 0.5 })
      headers.forEach((header, index) => page.drawText(header, { x: columns[index] + 3, y: y - 13, size: 7.5, font: bold, color: dark }))
      y -= 20
    }
    drawColumns()
    for (const row of employeeRows) {
      if (y < 90) { page = pdf.addPage([width, height]); pageNo += 1; y = drawHeader(page, employeeName, pageNo); drawColumns() }
      const values = [germanDate(row.workDate), row.start, row.end, `${row.pauseMinutes} Min.`, durationText(row.netMinutes), safePdfText(row.workArea, 22), safePdfText(row.location, 34)]
      page.drawRectangle({ x: margin, y: y - 17, width: width - margin * 2, height: 18, borderColor: line, borderWidth: 0.35 })
      values.forEach((value, index) => page.drawText(String(value), { x: columns[index] + 3, y: y - 11, size: index >= 5 ? 6.6 : 7.2, font: regular, color: dark }))
      y -= 17
    }
    const total = employeeRows.reduce((sum, row) => sum + row.netMinutes, 0)
    y -= 8
    page.drawText(`Gesamt: ${durationText(total)} Std.`, { x: margin, y, size: 10, font: bold, color: dark })
    page.drawText(safePdfText(`${settings.address} · ${settings.phone} · ${settings.email}`, 100), { x: margin, y: 32, size: 7, font: regular, color: dark })
  }
  return new Uint8Array(await pdf.save())
}
function safeSheetName(value: string, used: Set<string>) {
  const base = (value || 'Stundenzettel').replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'Stundenzettel'
  let name = base, suffix = 2
  while (used.has(name)) { const tail = ` ${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}` }
  used.add(name); return name
}
async function buildXlsx(rows: TimesheetEntry[], from: string, to: string) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const settings = await readCompanySettings()
  workbook.creator = settings.companyName
  workbook.created = new Date()
  const used = new Set<string>()
  const groups = groupRows(rows)
  for (const employeeRows of groups.length ? groups : [[] as TimesheetEntry[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Stundenzettel'
    const sheet = workbook.addWorksheet(safeSheetName(employeeName, used))
    sheet.addRow([settings.companyName]); sheet.addRow(['Stundenzettel', employeeName]); sheet.addRow(['Zeitraum', `${germanDate(from)} - ${germanDate(to)}`]); sheet.addRow([])
    sheet.addRow(['Datum', 'Beginn', 'Ende', 'Pause (Min.)', 'Dauer', 'Bereich', 'Einsatzort'])
    for (const row of employeeRows) sheet.addRow([germanDate(row.workDate), row.start, row.end, row.pauseMinutes, durationText(row.netMinutes), row.workArea, row.location])
    const total = employeeRows.reduce((sum, row) => sum + row.netMinutes, 0)
    sheet.addRow([]); sheet.addRow(['Gesamt', '', '', '', durationText(total)])
    sheet.columns = [{ width: 14 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 12 }, { width: 24 }, { width: 32 }]
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
    let rows = await listTimesheetEntries({ from, to, ...(userIds.length === 1 ? { employeeUserId: userIds[0] } : {}) })
    if (userIds.length > 1) { const allowed = new Set(userIds); rows = rows.filter((row) => allowed.has(row.employeeUserId)) }
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
