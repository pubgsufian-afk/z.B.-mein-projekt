import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { randomUUID } from 'node:crypto'
import { requirePortalRole } from './_shared/portal-role.mts'

export const MAX_REPORT_WORDS = 1000
const STORE_NAME = 'portal-daily-reports'

type DailyReport = {
  id: string
  text: string
  authorId: string
  authorName: string
  createdAt: string
}

type AccessProfile = {
  fullName?: string
} | null

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export function countWords(value: unknown) {
  const text = String(value || '').trim()
  return text ? text.split(/\s+/u).filter(Boolean).length : 0
}

export function validateDailyReportText(value: unknown) {
  const text = String(value || '').trim()
  const words = countWords(text)
  if (!text) return { ok: false as const, status: 400, message: 'Bitte zuerst einen Bericht eintragen.' }
  if (words > MAX_REPORT_WORDS) return { ok: false as const, status: 400, message: `Der Bericht darf höchstens ${MAX_REPORT_WORDS.toLocaleString('de-DE')} Wörter enthalten.` }
  return { ok: true as const, text, words }
}

async function authorNameFor(current: NonNullable<Awaited<ReturnType<typeof requirePortalRole>>['current']>) {
  const accessStore = getStore({ name: 'portal-access', consistency: 'strong' })
  const access = await accessStore.get(`access/${current.userId}`, { type: 'json' }) as AccessProfile
  const user = current.user as unknown as {
    userMetadata?: Record<string, unknown>
    appMetadata?: Record<string, unknown>
  }
  const name = String(
    access?.fullName
    || user.userMetadata?.full_name
    || user.userMetadata?.fullName
    || user.appMetadata?.full_name
    || user.appMetadata?.fullName
    || '',
  ).trim()
  if (name) return name
  const localPart = String(current.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return localPart || 'Admin'
}

async function listReports() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  const listed = await store.list({ prefix: 'reports/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<DailyReport | null>),
  )
  return rows
    .filter((report): report is DailyReport => Boolean(report?.id && report?.createdAt && report?.text))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

export default async function dailyReports(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!['GET', 'POST'].includes(request.method)) return response({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    const access = await requirePortalRole(['owner', 'admin'])
    if (access.response) return access.response
    const current = access.current
    if (!current) return response({ message: 'Nicht angemeldet.' }, 401)

    if (request.method === 'GET') {
      return response({ reports: await listReports() })
    }

    try { verifyRequestOrigin(request) } catch {
      return response({ message: 'Ungültige Anfragequelle.' }, 403)
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const validation = validateDailyReportText(body?.text)
    if (!validation.ok) return response({ message: validation.message }, validation.status)

    const createdAt = new Date().toISOString()
    const id = randomUUID()
    const report: DailyReport = {
      id,
      text: validation.text,
      authorId: current.userId,
      authorName: await authorNameFor(current),
      createdAt,
    }
    const store = getStore({ name: STORE_NAME, consistency: 'strong' })
    const chronologicalKey = `${String(Date.parse(createdAt)).padStart(13, '0')}-${id}`
    await store.setJSON(`reports/${chronologicalKey}`, report)
    return response({ report }, 201)
  } catch (error) {
    console.error('Habun daily reports', error)
    return response({ message: 'Der Tagesbericht konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/daily-reports' }
