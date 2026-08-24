import { randomUUID } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readCompanySettings } from './company-settings.mts'
import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './pdf-shield-logo.mts'
import {
  berlinDateKey,
  findDailyReportById,
  isIsoDateKey,
  listDailyReports,
  reportStore,
  safePdfFilenamePart,
  type DailyReport,
} from './daily-report-model.mts'

export const MAX_REPORT_WORDS = 1000
const RELAY_ACTOR_ID = 'portal-admin-relay'
const RELAY_ACTOR_NAME = 'Portal Admin Relay'

export class PortalAdminDailyReportError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'DAILY_REPORT_ERROR', status = 400) {
    super(message)
    this.name = 'PortalAdminDailyReportError'
    this.code = code
    this.status = status
  }
}

function countWords(value: unknown) {
  const text = String(value || '').trim()
  return text ? text.split(/\s+/u).filter(Boolean).length : 0
}

function validateText(value: unknown) {
  const text = String(value || '').trim()
  const words = countWords(text)
  if (!text) throw new PortalAdminDailyReportError('Bitte zuerst einen Bericht eintragen.', 'TEXT_REQUIRED', 400)
  if (words > MAX_REPORT_WORDS) throw new PortalAdminDailyReportError('Der Bericht ist zu lang.', 'TEXT_TOO_LONG', 400)
  return text
}

export async function listDailyReportsAdmin(date?: string) {
  const normalizedDate = String(date || '').trim()
  if (normalizedDate && !isIsoDateKey(normalizedDate)) {
    throw new PortalAdminDailyReportError('Ungültiges Datum.', 'INVALID_DATE', 400)
  }
  return (await listDailyReports(reportStore(), normalizedDate || undefined)).map(({ report }) => report)
}

export async function createDailyReportAdmin(textValue: unknown) {
  const text = validateText(textValue)
  const createdAt = new Date().toISOString()
  const id = randomUUID()
  const report: DailyReport = {
    id,
    text,
    authorId: RELAY_ACTOR_ID,
    authorName: RELAY_ACTOR_NAME,
    createdAt,
  }
  const chronologicalKey = `${String(Date.parse(createdAt)).padStart(13, '0')}-${id}`
  await reportStore().setJSON(`reports/${chronologicalKey}`, report)
  return report
}

export async function updateDailyReportAdmin(idValue: unknown, textValue: unknown) {
  const id = String(idValue || '').trim()
  const text = validateText(textValue)
  const store = reportStore()
  const found = await findDailyReportById(store, id)
  if (!found) throw new PortalAdminDailyReportError('Bericht nicht gefunden.', 'NOT_FOUND', 404)
  const updated: DailyReport = {
    ...found.report,
    text,
    updatedAt: new Date().toISOString(),
    updatedById: RELAY_ACTOR_ID,
    updatedByName: RELAY_ACTOR_NAME,
  }
  await store.setJSON(found.key, updated)
  return updated
}

export async function deleteDailyReportAdmin(idValue: unknown) {
  const id = String(idValue || '').trim()
  const store = reportStore()
  const found = await findDailyReportById(store, id)
  if (!found) throw new PortalAdminDailyReportError('Bericht nicht gefunden.', 'NOT_FOUND', 404)
  await store.delete(found.key)
  return { deleted: true, id }
}

function safePdfText(value: unknown) {
  return String(value ?? '').replace(/\r/g, '').replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '?')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function wrapText(value: string, font: any, size: number, maxWidth: number) {
  const lines: string[] = []
  for (const paragraph of safePdfText(value).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export async function generateDailyReportAdminPdf(input: Record<string, unknown>) {
  const id = String(input.id || '').trim()
  const date = String(input.date || '').trim()
  if ((!id && !date) || (id && date)) throw new PortalAdminDailyReportError('Bericht-ID oder Datum angeben.', 'INVALID_SELECTOR', 400)
  if (date && !isIsoDateKey(date)) throw new PortalAdminDailyReportError('Ungültiges Datum.', 'INVALID_DATE', 400)

  const store = reportStore()
  let reports: DailyReport[] = []
  let documentDate = date
  let filename = ''
  if (id) {
    const found = await findDailyReportById(store, id)
    if (!found) throw new PortalAdminDailyReportError('Bericht nicht gefunden.', 'NOT_FOUND', 404)
    reports = [found.report]
    documentDate = berlinDateKey(found.report.createdAt)
    filename = `Tagesbericht_${documentDate}_${safePdfFilenamePart(found.report.authorName)}.pdf`
  } else {
    reports = (await listDailyReports(store, date)).map(({ report }) => report).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (!reports.length) throw new PortalAdminDailyReportError('Für diesen Tag sind keine Berichte vorhanden.', 'NO_DATA', 404)
    filename = `Tagesberichte_${date}.pdf`
  }

  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf)
  const width = 595.28
  const height = 841.89
  const margin = 48
  let page = pdf.addPage([width, height])
  let y = height - 190

  const drawHeader = () => {
    if (logo) drawCenteredShieldLogo(page, logo, width, height - 25, 62)
    const company = safePdfText(settings.companyName || 'Habun Security')
    page.drawText(company, { x: centeredTextX(bold, company, 13, width), y: height - 125, size: 13, font: bold })
    page.drawText(date ? 'Tagesberichte' : 'Tagesbericht', { x: margin, y: height - 160, size: 18, font: bold })
    page.drawText(`Datum: ${documentDate}`, { x: margin, y: height - 176, size: 9, font: regular, color: rgb(.35, .35, .35) })
    y = height - 205
  }
  drawHeader()

  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index]
    if (y < 150) {
      page = pdf.addPage([width, height])
      drawHeader()
    }
    page.drawText(reports.length > 1 ? `Bericht ${index + 1}` : 'Bericht', { x: margin, y, size: 11, font: bold })
    y -= 16
    page.drawText(`Verfasser: ${safePdfText(report.authorName || 'Admin')}`, { x: margin, y, size: 8.5, font: regular })
    y -= 13
    page.drawText(`Erstellt: ${formatDate(report.createdAt)} ${formatTime(report.createdAt)} Uhr`, { x: margin, y, size: 8.5, font: regular })
    y -= 18
    const lines = wrapText(report.text, regular, 10.5, width - margin * 2)
    for (const line of lines) {
      if (y < 60) {
        page = pdf.addPage([width, height])
        drawHeader()
      }
      if (line) page.drawText(line, { x: margin, y, size: 10.5, font: regular })
      y -= 15
    }
    y -= 20
  }

  return {
    bytes: new Uint8Array(await pdf.save()),
    filename,
    contentType: 'application/pdf',
    rowCount: reports.length,
  }
}
