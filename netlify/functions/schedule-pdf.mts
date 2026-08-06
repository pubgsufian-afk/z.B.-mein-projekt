import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readCompanySettings } from './_shared/company-settings.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
type ScheduleEntry = {
  id?: string
  employeeName?: string
  employeeUserId?: string
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
  return { userId: user.id, role }
}

function clean(value: unknown, maximum = 80) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safePdfText(value: unknown, maximum = 80) {
  return clean(value, maximum).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function germanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) : value
}

async function embedLogo(pdf: PDFDocument, request: Request, logoUrl: string) {
  try {
    const response = await fetch(new URL(logoUrl || '/habun-logo.png', request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return response.headers.get('content-type')?.includes('jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  } catch { return null }
}

async function buildSchedulePdf(request: Request, entries: ScheduleEntry[], from: string, to: string) {
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logo = await embedLogo(pdf, request, settings.logoUrl)
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
    y = height - margin
    if (logo) {
      const scale = Math.min(74 / logo.width, 58 / logo.height)
      page.drawImage(logo, { x: margin, y: y - logo.height * scale + 4, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(safePdfText(settings.companyName, 60), { x: 122, y: y - 2, size: 16, font: bold })
    page.drawText(safePdfText(settings.phone || 'Telefon nicht hinterlegt', 70), { x: 122, y: y - 17, size: 8.5, font: regular })
    page.drawText(safePdfText(settings.email || 'E-Mail nicht hinterlegt', 90), { x: 122, y: y - 30, size: 8.5, font: regular })
    page.drawText('Dienstplan', { x: margin, y: y - 65, size: 15, font: bold })
    page.drawText(`Zeitraum ${from} bis ${to} | Seite ${pageNumber}`, { x: margin, y: y - 81, size: 8.5, font: regular })
    y -= 108
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
      germanDate(clean(entry.date, 10)),
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

export default async function schedulePdf(request: Request, _context: Context) {
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
    console.error('Habun schedule PDF', error)
    return json({ message: 'Der Dienstplan konnte nicht als PDF erzeugt werden.', code: 'SCHEDULE_PDF_FAILED' }, 500)
  }
}

export const config: Config = { path: '/api/schedule-pdf' }
