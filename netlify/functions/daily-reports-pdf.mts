import type { Config } from '@netlify/functions'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { readCompanySettings } from './_shared/company-settings.mts'
import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'
import { requirePortalRole } from './_shared/portal-role.mts'
import {
  berlinDateKey,
  findDailyReportById,
  isIsoDateKey,
  listDailyReports,
  reportStore,
  safePdfFilenamePart,
  type DailyReport,
} from './_shared/daily-report-model.mts'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const BODY_SIZE = 10.5
const BODY_LINE_HEIGHT = 15
const BOTTOM_LIMIT = 58
const BERLIN_TIME_ZONE = 'Europe/Berlin'

type PdfContext = {
  pdf: PDFDocument
  regular: PDFFont
  bold: PDFFont
  logo: PDFImage | null
  companyName: string
  companyPhone: string
  companyEmail: string
  documentTitle: string
  documentDate: string
}

type PageCursor = {
  page: PDFPage
  y: number
}

function jsonError(message: string, status: number) {
  return Response.json({ message }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function safePdfText(value: unknown) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '?')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function formatDateKey(value: string) {
  if (!isIsoDateKey(value)) return value
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number) {
  const chunks: string[] = []
  let chunk = ''
  for (const character of word) {
    const next = `${chunk}${character}`
    if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
      chunks.push(chunk)
      chunk = character
    } else {
      chunk = next
    }
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

function wrapText(value: unknown, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = []
  for (const rawParagraph of safePdfText(value).split('\n')) {
    const words = rawParagraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (const rawWord of words) {
      const pieces = font.widthOfTextAtSize(rawWord, size) <= maxWidth
        ? [rawWord]
        : splitLongWord(rawWord, font, size, maxWidth)
      for (const word of pieces) {
        const candidate = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate
        } else {
          if (line) lines.push(line)
          line = word
        }
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function addPage(context: PdfContext): PageCursor {
  const page = context.pdf.addPage(A4)
  const { width, height } = page.getSize()
  drawCenteredShieldLogo(page, context.logo, width, height - 26, 62)

  page.drawText(context.companyName, {
    x: centeredTextX(context.bold, context.companyName, 13, width),
    y: height - 125,
    size: 13,
    font: context.bold,
    color: rgb(0.08, 0.08, 0.08),
  })

  if (context.companyPhone) {
    page.drawText(context.companyPhone, {
      x: centeredTextX(context.regular, context.companyPhone, 8, width),
      y: height - 141,
      size: 8,
      font: context.regular,
      color: rgb(0.28, 0.28, 0.28),
    })
  }
  if (context.companyEmail) {
    page.drawText(context.companyEmail, {
      x: centeredTextX(context.regular, context.companyEmail, 8, width),
      y: height - 153,
      size: 8,
      font: context.regular,
      color: rgb(0.28, 0.28, 0.28),
    })
  }

  page.drawLine({
    start: { x: MARGIN, y: height - 169 },
    end: { x: width - MARGIN, y: height - 169 },
    thickness: 0.8,
    color: rgb(0.78, 0.65, 0.28),
  })

  page.drawText(context.documentTitle, {
    x: MARGIN,
    y: height - 198,
    size: 19,
    font: context.bold,
    color: rgb(0.08, 0.08, 0.08),
  })
  page.drawText(`Datum: ${safePdfText(context.documentDate)}`, {
    x: MARGIN,
    y: height - 216,
    size: 9.5,
    font: context.regular,
    color: rgb(0.32, 0.32, 0.32),
  })

  return { page, y: height - 246 }
}

function ensureSpace(context: PdfContext, cursor: PageCursor, needed: number) {
  return cursor.y - needed < BOTTOM_LIMIT ? addPage(context) : cursor
}

function drawReport(context: PdfContext, cursor: PageCursor, report: DailyReport, index: number, total: number) {
  cursor = ensureSpace(context, cursor, report.updatedAt ? 96 : 78)
  const { width } = cursor.page.getSize()

  const sectionTitle = total > 1 ? `Bericht ${index + 1}` : 'Bericht'
  cursor.page.drawText(sectionTitle, {
    x: MARGIN,
    y: cursor.y,
    size: 12,
    font: context.bold,
    color: rgb(0.15, 0.15, 0.15),
  })
  cursor.y -= 20

  const metadata = [
    `Verfasser: ${safePdfText(report.authorName || 'Admin')}`,
    `Erstellt: ${formatDate(report.createdAt)} · ${formatTime(report.createdAt)} Uhr`,
  ]
  if (report.updatedAt) {
    const editor = report.updatedByName ? ` · von ${safePdfText(report.updatedByName)}` : ''
    metadata.push(`Zuletzt bearbeitet: ${formatDate(report.updatedAt)} · ${formatTime(report.updatedAt)} Uhr${editor}`)
  }

  for (const line of metadata) {
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: context.regular,
      color: rgb(0.35, 0.35, 0.35),
    })
    cursor.y -= 14
  }

  cursor.y -= 4
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: width - MARGIN, y: cursor.y },
    thickness: 0.45,
    color: rgb(0.82, 0.82, 0.82),
  })
  cursor.y -= 19

  const lines = wrapText(report.text, context.regular, BODY_SIZE, width - (MARGIN * 2))
  for (const line of lines) {
    if (cursor.y < BOTTOM_LIMIT + BODY_LINE_HEIGHT) cursor = addPage(context)
    if (line) {
      cursor.page.drawText(line, {
        x: MARGIN,
        y: cursor.y,
        size: BODY_SIZE,
        font: context.regular,
        color: rgb(0.10, 0.10, 0.10),
      })
    }
    cursor.y -= BODY_LINE_HEIGHT
  }
  cursor.y -= 18
  return cursor
}

async function buildPdf(request: Request, reports: DailyReport[], documentDate: string, dayMode: boolean) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf, request)
  const settings = await readCompanySettings()

  const context: PdfContext = {
    pdf,
    regular,
    bold,
    logo,
    companyName: safePdfText(settings.companyName || 'Habun Security'),
    companyPhone: safePdfText(settings.phone || ''),
    companyEmail: safePdfText(settings.email || ''),
    documentTitle: dayMode ? 'Tagesberichte' : 'Tagesbericht',
    documentDate: formatDateKey(documentDate),
  }

  let cursor = addPage(context)
  reports.forEach((report, index) => {
    cursor = drawReport(context, cursor, report, index, reports.length)
  })

  const pages = pdf.getPages()
  pages.forEach((page, index) => {
    const label = `Seite ${index + 1} von ${pages.length}`
    page.drawText(label, {
      x: centeredTextX(regular, label, 8, page.getWidth()),
      y: 25,
      size: 8,
      font: regular,
      color: rgb(0.42, 0.42, 0.42),
    })
  })
  return pdf.save()
}

export default async function dailyReportsPdf(request: Request) {
  if (request.method !== 'GET') return jsonError('Methode nicht erlaubt.', 405)

  try {
    const access = await requirePortalRole(['owner', 'admin'])
    if (access.response) return access.response

    const url = new URL(request.url)
    const id = url.searchParams.get('id')?.trim() || ''
    const date = url.searchParams.get('date')?.trim() || ''
    if ((!id && !date) || (id && date)) return jsonError('Bericht-ID oder Datum angeben.', 400)
    if (date && !isIsoDateKey(date)) return jsonError('Ungültiges Datum.', 400)

    const store = reportStore()
    let reports: DailyReport[] = []
    let documentDate = date
    let filename = ''

    if (id) {
      const found = await findDailyReportById(store, id)
      if (!found) return jsonError('Bericht nicht gefunden.', 404)
      reports = [found.report]
      documentDate = berlinDateKey(found.report.createdAt)
      filename = `Tagesbericht_${documentDate}_${safePdfFilenamePart(found.report.authorName)}.pdf`
    } else {
      reports = (await listDailyReports(store, date))
        .map(({ report }) => report)
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      if (!reports.length) return jsonError('Für diesen Tag sind keine Berichte vorhanden.', 404)
      filename = `Tagesberichte_${date}.pdf`
    }

    const bytes = await buildPdf(request, reports, documentDate, Boolean(date))
    return new Response(bytes as BodyInit, {
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
    console.error('Habun daily report PDF', error)
    return jsonError('Der Tagesbericht konnte nicht als PDF erzeugt werden.', 500)
  }
}

export const config: Config = { path: '/api/daily-reports-pdf' }
