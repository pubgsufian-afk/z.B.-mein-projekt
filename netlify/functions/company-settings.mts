import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { readCompanySettings, writeCompanySettings } from './_shared/company-settings.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null

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
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

export default async function companySettings(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
  if (request.method === 'GET') return json({ settings: await readCompanySettings() })
  if (request.method !== 'PUT') return json({ message: 'Methode nicht erlaubt.' }, 405)
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Nur Admin oder Hauptadmin darf Firmendaten ändern.' }, 403)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
    const settings = await writeCompanySettings(body, { userId: current.userId })
    return json({ settings })
  } catch (error) {
    if (error instanceof TypeError) return json({ message: error.message }, 400)
    console.error('Company settings', error)
    return json({ message: 'Die Firmendaten konnten nicht gespeichert werden.' }, 500)
  }
}

export const config: Config = { path: '/api/company-settings' }
