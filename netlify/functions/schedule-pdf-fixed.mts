import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readCompanySettings } from './_shared/company-settings.mts'
import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
type ScheduleEntry = {
  id?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  pauseMinutes?: number
  location?: string
  workArea?: string
  status?: string
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

function clean(value: unknown, maximum = 100) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safePdfText(value: unknown, maximum = 100) {
  return clean(value, maximum).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function germanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
    : value
}

async function buildSchedulePdf(request: Request, entries: ScheduleEntry[], from: string, to: string) {
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await loadOriginalLogo(pdf, request)
  const width = 842
  const height = 595
  const margin = 32
  const columns = [32, 105, 228, 284, 340, 398, 570]
  let page: ReturnType<typeof pdf.addPage>
  let y = 0
  let pageNumber = 0

  const newPage = () => {
    page = pdf.addPage([width, height])
    pageNumber += 1
    drawCenteredShieldLogo(page, logo, width, height - 22, 64)
    const company = safePdfText(settings.companyName || 'Habun Security', 70)
    const phone = safePdfText(settings.phone || 'Telefon nicht hinterlegt', 70)
    const email = safePdfText(settings.email || 'E-Mail nicht hinterlegt', 90)
    page.drawText(company, { x: centeredTextX(bold, company, 16, width), y: 482, size: 16, font: bold, color: rgb(.08, .08, .08) })
    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 466, size: 8.5, font: regular })
    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 453, size: 8.5, font: regular })
    page.drawText('Dienstplan', { x: margin, y: 424, size: 15, font: bold })
    page.drawText(safePdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 408, size: 8.5, font: regular })
    y = 378
    const headers = ['Datum', 'Mitarbeiter', 'Beginn', 'Ende', 'Pause', 'Einsatzort', 'Arbeitsbereich']
    headers.forEach((header, index) => page.drawText(header, { x: columns[index], y, size: 8, font: bold, color: rgb(.12, .12, .12) }))
    y -= 8
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .7, color: rgb(.45, .45, .45) })
    y -= 15
  }

  newPage()
  for (const entry of entries) {
    if (y < 58) newPage()
    const values = [
      safePdfText(germanDate(clean(entry.date, 10)), 18),
      safePdfText(entry.employeeName || 'Mitarbeiter', 22),
      safePdfText(entry.start || '-', 8),
      safePdfText(entry.end || '-', 8),
      `${Number(entry.pauseMinutes || 0)} Min.`,
      safePdfText(entry.location || '-', 28),
      safePdfText(entry.workArea || '-', 24),
    ]
    values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.5, font: regular }))
    y -= 19
  }
  return pdf.save()
}

export default async function schedulePdfFixed(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Mitarbeiter dürfen keinen Dienstplan als PDF herunterladen.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as { from?: string; to?: string } | null
  const from = String(body?.from || '')
  const to = String(body?.to || '')
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return json({ message: 'Der Zeitraum ist ungültig.' }, 400)

  try {
    const url = new URL('/api/schedule-v2', request.url)
    url.searchParams.set('resource', 'entries')
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    const response = await fetch(url, { headers: request.headers, cache: 'no-store' })
    if (!response.ok) return json({ message: 'Der Dienstplan konnte nicht geladen werden.', code: 'SCHEDULE_QUERY_FAILED' }, 502)
    const payload = await response.json().catch(() => ({})) as { entries?: ScheduleEntry[] }
    const entries = (Array.isArray(payload.entries) ? payload.entries : [])
      .filter((entry) => entry.status === 'published')
      .sort((a, b) => `${a.date || ''}-${a.start || ''}-${a.employeeName || ''}`.localeCompare(`${b.date || ''}-${b.start || ''}-${b.employeeName || ''}`, 'de'))
    if (!entries.length) return json({ message: 'Für diesen Zeitraum sind keine freigegebenen Dienste vorhanden.', code: 'NO_SCHEDULE_DATA' }, 404)

    const bytes = await buildSchedulePdf(request, entries, from, to)
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Habun-Dienstplan-${from}-bis-${to}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('Habun fixed schedule PDF', error)
    return json({ message: 'Der Dienstplan konnte nicht als PDF erzeugt werden.', code: 'SCHEDULE_PDF_FAILED' }, 500)
  }
}
