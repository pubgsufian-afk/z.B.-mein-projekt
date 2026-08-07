import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { currentPortalActor } from './_shared/portal-role.mts'
import { syncScheduleEmployees, type ScheduleEmployee } from './_shared/schedule-neon-repository.mts'

type AccessRecord = {
  userId?: string
  role?: string
  status?: string
  fullName?: string
  location?: string
}

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

export default async function scheduleDirectory(_request: Request, _context: Context) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!['owner', 'admin', 'manager', 'scheduler'].includes(String(current.role))) {
    return json({ message: 'Keine Berechtigung.' }, 403)
  }

  const store = getStore({ name: 'portal-access', consistency: 'strong' })
  const listed = await store.list({ prefix: 'access/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AccessRecord | null>),
  )
  const allowedRoles = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])
  const employees = rows
    .filter((row): row is AccessRecord => Boolean(row?.userId && row.status === 'active' && row.role && allowedRoles.has(String(row.role))))
    .map((row) => ({
      userId: String(row.userId),
      id: String(row.userId),
      fullName: String(row.fullName || 'Mitarbeiter'),
      location: String(row.location || ''),
      role: String(row.role || 'employee'),
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName, 'de'))

  await syncScheduleEmployees(employees.map((employee) => ({
    userId: employee.userId,
    fullName: employee.fullName,
    role: employee.role as ScheduleEmployee['role'],
    status: 'active',
    location: employee.location,
  })), true)

  return json({ employees })
}

export const config: Config = { path: '/api/schedule-directory' }
