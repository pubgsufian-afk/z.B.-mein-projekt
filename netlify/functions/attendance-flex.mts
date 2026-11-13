import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { currentPortalActor } from './_shared/portal-role.mts'
import {
  AttendanceServiceError,
  createAttendanceService,
  normalizeClockRequest,
} from './_shared/attendance-service.mts'
import { createAttendanceRepository } from './_shared/neon-attendance.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import {
  flexCheckoutDeadline,
  isFlexClockAccount,
} from './_shared/attendance-automation-policy.mts'
import {
  createFlexAutoShift,
  deleteFlexAutoShift,
  findScheduleTiming,
  finishFlexAutoShift,
} from './_shared/attendance-auto-shift.mts'

type Worksite = {
  id: string
  name: string
  address?: string
  latitude: number | null
  longitude: number | null
  radiusMeters: number
}

type AccessRecord = { fullName?: string; status?: string } | null

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

function configuredFlexEmails() {
  const runtime = typeof Netlify !== 'undefined' ? Netlify.env.get('ATTENDANCE_FLEX_ACCOUNT_EMAILS') || '' : ''
  return runtime || process.env.ATTENDANCE_FLEX_ACCOUNT_EMAILS || ''
}

const REMOTE_WORKSITE: Worksite = {
  id: 'habun-flex-remote-v1',
  name: 'Standortunabhängige Zeiterfassung',
  latitude: null,
  longitude: null,
  radiusMeters: 0,
}

function activeFlexScheduleId(events: Array<Record<string, unknown>>, phase: string) {
  if (!['working', 'paused'].includes(phase)) return null
  const latestStart = [...events].reverse().find((event) => event.action === 'clock-in')
  const scheduleId = String(latestStart?.scheduleId || '')
  return scheduleId.startsWith('attendance-flex:') ? scheduleId : null
}

export function flexStateForEligibility<T extends Record<string, any>>(state: T, eligible: boolean) {
  if (!eligible || state.schedule || state.phase !== 'blocked') return state
  return { ...state, phase: 'idle', clocking: { allowed: true, code: 'FLEX_ACCOUNT' } }
}

async function actorFullName(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>) {
  const access = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get(`access/${current.userId}`, { type: 'json' }) as AccessRecord
  const identity = current.user as unknown as {
    userMetadata?: Record<string, unknown>
    user_metadata?: Record<string, unknown>
  }
  const metadata = identity.userMetadata || identity.user_metadata || {}
  const name = String(access?.fullName || metadata.full_name || '').trim()
  if (!name) throw new AttendanceServiceError('Für dieses Konto ist kein Mitarbeitername hinterlegt.', 422, 'EMPLOYEE_NAME_REQUIRED')
  return name
}

async function ensureAttendanceObject(site: Worksite) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO attendance_objects
       (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,now(),'system:attendance-flex')
     ON CONFLICT (id) DO UPDATE SET
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       accuracy_meters = EXCLUDED.accuracy_meters,
       radius_meters = EXCLUDED.radius_meters,
       updated_at = now(),
       updated_by = 'system:attendance-flex'`,
    [site.id, site.latitude, site.longitude, site.latitude == null || site.longitude == null ? null : 0, site.radiusMeters || 500],
  )
}

async function attendanceService() {
  const connectionString = databaseConnectionString()
  if (!connectionString) throw new AttendanceServiceError('Die Zeiterfassungsdatenbank ist noch nicht verbunden.', 503, 'DATABASE_NOT_CONFIGURED')
  return createAttendanceService({ repository: await createAttendanceRepository(connectionString), allowRemoteClockIn: true })
}

export default async function attendanceFlex(request: Request, _context: Context) {
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)
  try {
    const current = await currentPortalActor()
    if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
    if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
    const eligible = isFlexClockAccount(current.email, configuredFlexEmails())

    if (request.method === 'GET') {
      const resource = new URL(request.url).searchParams.get('resource') || 'eligibility'
      if (resource === 'eligibility') return json({ eligible })
      if (resource !== 'state') return json({ message: 'Unbekannter Bereich.' }, 400)
      if (!eligible) return json({ message: 'Keine Berechtigung.' }, 403)
      const service = await attendanceService()
      const state = await service.getState({ userId: current.userId, email: current.email, role: current.role })
      const openFlex = activeFlexScheduleId(state.events, state.phase)
      // A completed session must not prevent the next independent check-in.
      return json({
        phase: state.phase === 'completed' ? 'idle' : state.phase,
        rawPhase: state.phase,
        clockInAt: state.clockInAt,
        clockOutAt: state.clockOutAt,
        schedule: null,
        clocking: { allowed: true, code: 'FLEX_ACCOUNT' },
        flexSession: Boolean(openFlex),
      })
    }

    try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
    if (!eligible) return json({ message: 'Keine Berechtigung.', code: 'FLEX_ACCOUNT_REQUIRED' }, 403)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
    const action = String(body.action || '')
    if (!['clock-in', 'break-start', 'break-end', 'clock-out'].includes(action)) return json({ message: 'Diese Flex-Aktion ist nicht erlaubt.' }, 400)

    const serverNow = new Date()
    const normalized = normalizeClockRequest({ ...body, clientOccurredAt: serverNow.toISOString(), action })
    const service = await attendanceService()

    if (action === 'clock-in') {
      // This is a real recorded shift, not a change to another employee's schedule.
      await ensureAttendanceObject(REMOTE_WORKSITE)
      const scheduleId = `attendance-flex:${current.userId}:${normalized.clientEventId}`
      const fullName = await actorFullName(current)
      const deadline = flexCheckoutDeadline(serverNow)
      const created = await createFlexAutoShift({
        scheduleId,
        userId: current.userId,
        fullName,
        checkInAt: serverNow,
        deadlineAt: deadline,
        worksite: { id: REMOTE_WORKSITE.id, name: REMOTE_WORKSITE.name },
        sourceRef: normalized.clientEventId,
      })
      try {
        await service.record({ userId: current.userId, email: current.email, role: current.role }, {
          action,
          clientEventId: normalized.clientEventId,
          clientOccurredAt: serverNow.toISOString(),
          scheduleId,
          objectId: REMOTE_WORKSITE.id,
          offlineCaptured: false,
          location: null,
        })
      } catch (error) {
        if (created.created) await deleteFlexAutoShift(scheduleId, current.userId, normalized.clientEventId).catch(() => {})
        throw error
      }
      return json({ saved: true, action, scheduleId }, 201)
    }

    // Only an open flex session belonging to the signed-in user can be continued.
    const state = await service.getState({ userId: current.userId, email: current.email, role: current.role })
    const scheduleId = activeFlexScheduleId(state.events, state.phase)
    const timing = scheduleId ? await findScheduleTiming(scheduleId) : null
    if (!timing || timing.source !== 'attendance-flex' || timing.employeeUserId !== current.userId || timing.objectId !== REMOTE_WORKSITE.id) {
      return json({ message: 'Keine passende laufende Sonderbuchung gefunden.', code: 'FLEX_SHIFT_NOT_FOUND' }, 404)
    }
    await service.record({ userId: current.userId, email: current.email, role: current.role }, {
      action,
      clientEventId: normalized.clientEventId,
      clientOccurredAt: serverNow.toISOString(),
      scheduleId: timing.id,
      objectId: timing.objectId,
      offlineCaptured: false,
      location: null,
    })
    if (action === 'clock-out') await finishFlexAutoShift(timing.id, current.userId, serverNow)
    return json({ saved: true, action, scheduleId: timing.id }, 201)
  } catch (error) {
    if (error instanceof AttendanceServiceError) return json({ message: error.message, code: error.code }, error.status)
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message, code: 'INVALID_INPUT' }, 400)
    console.error('Habun flex attendance', error)
    return json({ message: 'Die Flex-Zeiterfassung konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-flex' }
