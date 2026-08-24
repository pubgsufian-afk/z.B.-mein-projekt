import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import {
  AttendanceAdminError,
  attendanceAdminService,
  type AttendanceAdminActor,
} from './_shared/attendance-admin-service.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

const DIRECT_TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])

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

async function editTime(request: Request) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!DIRECT_TIME_EDIT_ROLES.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

  const actor: AttendanceAdminActor = {
    userId: current.userId,
    email: current.email,
    role: current.role as AttendanceAdminActor['role'],
  }

  try {
    const result = await attendanceAdminService().updateSession({
      clockInEventId: String(body.clockInEventId || ''),
      clockOutEventId: body.clockOutEventId == null ? null : String(body.clockOutEventId),
      clockInAt: String(body.clockInAt || ''),
      clockOutAt: body.clockOutAt == null || String(body.clockOutAt).trim() === '' ? null : String(body.clockOutAt),
      pauseMinutes: Number(body.pauseMinutes),
      reason: String(body.reason || ''),
    }, actor)
    return json(result)
  } catch (error) {
    if (error instanceof AttendanceAdminError) return json({ message: error.message }, error.status)
    console.error('Habun direct attendance time edit', error)
    return json({ message: 'Die Arbeitszeit konnte nicht geändert werden.' }, 500)
  }
}

export default async function attendanceTimeEdit(request: Request, _context: Context) {
  return editTime(request)
}

export const config: Config = { path: '/api/attendance-time-edit' }
