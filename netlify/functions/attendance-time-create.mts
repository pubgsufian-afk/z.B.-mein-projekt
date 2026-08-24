import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import {
  AttendanceAdminError,
  attendanceAdminService,
  type AttendanceAdminActor,
} from './_shared/attendance-admin-service.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

const DIRECT_TIME_CREATE_ROLES = new Set(['owner', 'admin', 'manager'])

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

async function createManualTime(request: Request) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!DIRECT_TIME_CREATE_ROLES.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
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
    const result = await attendanceAdminService().createSession({
      userId: String(body.userId || ''),
      clockInAt: String(body.clockInAt || ''),
      clockOutAt: String(body.clockOutAt || ''),
      pauseMinutes: Number(body.pauseMinutes),
      scheduleId: body.scheduleId == null ? null : String(body.scheduleId),
      objectId: body.objectId == null ? null : String(body.objectId),
      reason: 'Manueller Stundenzettel-Eintrag',
    }, actor)
    return json(result, 201)
  } catch (error) {
    if (error instanceof AttendanceAdminError) return json({ message: error.message }, error.status)
    console.error('Habun manual timesheet entry', error)
    return json({ message: 'Die Arbeitszeit konnte nicht eingetragen werden.' }, 500)
  }
}

export default async function attendanceTimeCreate(request: Request, _context: Context) {
  return createManualTime(request)
}

export const config: Config = { path: '/api/attendance-time-create' }
