import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

function databaseUrl() {
  return Netlify.env.get('ATTENDANCE_DATABASE_URL') || Netlify.env.get('DATABASE_URL') || Netlify.env.get('NETLIFY_DATABASE_URL') || ''
}

export default async function worksiteV2(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const siteStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  if (request.method === 'GET') {
    const listed = await siteStore.list({ prefix: 'objects/' })
    const objects = (await Promise.all(listed.blobs.map((blob) => siteStore.get(blob.key, { type: 'json' })))).filter(Boolean)
    return json({ objects })
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Nur die Administration darf Einsatzort-Koordinaten ändern.' }, 403)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const id = String(body.id || crypto.randomUUID()).trim()
  const name = String(body.name || '').trim()
  const address = String(body.address || '').trim()
  const latitude = body.latitude === '' || body.latitude == null ? null : Number(body.latitude)
  const longitude = body.longitude === '' || body.longitude == null ? null : Number(body.longitude)
  const hasCoordinates = latitude !== null || longitude !== null
  const coordinatesComplete = latitude !== null && longitude !== null
  const accuracyMeters = coordinatesComplete
    ? Math.max(0, Number.isFinite(Number(body.accuracyMeters)) ? Number(body.accuracyMeters) : 0)
    : null
  const radiusMeters = Number(body.radiusMeters || 500)
  if (!name || !address) return json({ message: 'Name und Adresse sind erforderlich.' }, 400)
  if (hasCoordinates && !coordinatesComplete) return json({ message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' }, 400)
  if ((latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) || (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))) {
    return json({ message: 'Die Koordinaten sind ungültig.' }, 400)
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0 || radiusMeters > 10000) return json({ message: 'Der Prüfradius ist ungültig.' }, 400)
  const object = { id, name, address, latitude, longitude, accuracyMeters, radiusMeters, updatedAt: new Date().toISOString(), updatedBy: current.userId }
  await siteStore.setJSON(`objects/${id}`, object)
  const url = databaseUrl()
  if (url) {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(url)
    await sql(
      `INSERT INTO attendance_objects (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,now(),$6)
       ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         accuracy_meters = EXCLUDED.accuracy_meters, radius_meters = EXCLUDED.radius_meters,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [id, latitude, longitude, accuracyMeters, radiusMeters, current.userId],
    )
  }
  return json({ object, databaseSynced: Boolean(url) }, 201)
}

export const config: Config = { path: '/api/worksite-v2' }
