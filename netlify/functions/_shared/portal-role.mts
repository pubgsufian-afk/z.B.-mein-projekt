import { getStore } from '@netlify/blobs'
import { getUser } from '@netlify/identity'

export type PortalRole = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: PortalRole; status?: string } | null

const VALID_ROLES = new Set<PortalRole>(['owner', 'admin', 'manager', 'employee', 'pending'])

export async function currentPortalActor() {
  const user = await getUser()
  if (!user) return null

  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set(
    (Netlify.env.get('PORTAL_OWNER_EMAILS') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  const access = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadata = Array.isArray(user.appMetadata?.roles)
    ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string')
    : []
  const direct = typeof (user as { role?: unknown }).role === 'string'
    ? [(user as { role: string }).role]
    : []
  const accessBlocked = access?.status === 'inactive' || access?.status === 'rejected'
  const role = owners.has(email)
    ? 'owner'
    : accessBlocked
      ? 'pending'
      : access?.status === 'active' && access.role && VALID_ROLES.has(access.role)
        ? access.role
        : ([...(user.roles || []), ...metadata, ...direct]
            .find((value) => VALID_ROLES.has(value as PortalRole)) as PortalRole || 'pending')

  return { user, userId: user.id, email, role }
}

export async function requirePortalRole(roles: PortalRole[]) {
  const current = await currentPortalActor()
  if (!current) return { current: null, response: Response.json({ message: 'Nicht angemeldet.' }, { status: 401, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }) }
  if (!roles.includes(current.role)) return { current, response: Response.json({ message: 'Keine Berechtigung.' }, { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }) }
  return { current, response: null }
}
