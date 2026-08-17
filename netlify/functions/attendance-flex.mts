import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { currentPortalActor } from './_shared/portal-role.mts'
import {
  AttendanceServiceError,
  createAttendanceService,
  normalizeClockRequest,
} from './_shared/daily-attendance-service.mts'
import { createAttendanceRepository } from './_shared/neon-attendance.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import {
  findAllowedWorksite,
  flexCheckoutDeadline,
  isFlexClockAccount,
} from './_shared/attendance-automation-policy.mts'
import {
  berlinDateTimeParts,
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

function configuredFlexEmail() {
  const runtime = typeof Netlify !== 'undefined' ? Netlify.env.get('ATTENDANCE_FLEX_ACCOUNT_EMAIL') || '' : ''
  return runtime || process.env.ATTENDANCE_FLEX_ACCOUNT_EMAIL || ''
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

async function loadWorksites(): Promise<Worksite[]> {
  const store = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await store.list({ prefix: 'objects/' })
  const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<Worksite | null>))
  return rows.filter((row): row is Worksite => Boolean(row?.id && row?.name))
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

async function hasPublishedShiftForDate(userId: string, date: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT id FROM schedule_shifts
      WHERE employee_user_id = $1 AND shift_date = $2::date AND status = 'published'
      LIMIT 1`,
    [userId, date],
  )
  return Boolean(result.rows[0])
}

async function attendanceService() {
  const connectionString = databaseConnectionString()
  if (!connectionString) throw new AttendanceServiceError('Die Zeiterfassungsdatenbank ist noch nicht verbunden.', 503, 'DATABASE_NOT_CONFIGURED')
  return createAttendanceService({ repository: await createAttendanceRepository(connectionString) })
}

export default async function attendanceFlex(request: Request, _context: Context) {
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)
  try {
    const current = await currentPortalActor()
    if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
    if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
    const eligible = isFlexClockAccount(current.email, configuredFlexEmail())

    if (request.method === 'GET') {
      const resource = new URL(request.url).searchParams.get('resource') || 'eligibility'
      if (resource !== 'eligibility') return json({ message: 'Unbekannter Bereich.' }, 400)
      return json({ eligible })
    }

    try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
    if (!eligible) return json({ message: 'Keine Berechtigung.', code: 'FLEX_ACCOUNT_REQUIRED' }, 403)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
    const action = String(body.action || '')
    if (!['clock-in', 'clock-out'].includes(action)) return json({ message: 'Diese Flex-Aktion ist nicht erlaubt.' }, 400)

    const serverNow = new Date()
    const normalized = normalizeClockRequest({ ...body, clientOccurredAt: serverNow.toISOString(), action })
    const service = await attendanceService()

    if (action === 'clock-in') {
      const today = berlinDateTimeParts(serverNow).date
      if (await hasPublishedShiftForDate(current.userId, today)) {
        return json({ message: 'Für heute ist bereits ein Dienst veröffentlicht. Bitte die normale Stempeluhr verwenden.', code: 'PUBLISHED_SHIFT_EXISTS' }, 409)
      }
      if (!normalized.location) {
        return json({ message: 'Der Geräte-Standort konnte nicht ermittelt werden.', code: 'DEVICE_LOCATION_REQUIRED' }, 422)
      }
      const worksites = await loadWorksites()
      const site = findAllowedWorksite(worksites, normalized.location) as Worksite | null
      if (!site) return json({ message: 'Du befindest dich außerhalb eines gespeicherten Einsatzortes.', code: 'OUTSIDE_WORKSITE' }, 403)
      if (site.latitude == null || site.longitude == null) return json({ message: 'Für diesen Einsatzort sind keine gültigen Koordinaten gespeichert.', code: 'WORKSITE_NOT_CONFIGURED' }, 422)

      await ensureAttendanceObject(site)
      const scheduleId = `attendance-flex:${current.userId}:${normalized.clientEventId}`
      const fullName = await actorFullName(current)
      const deadline = flexCheckoutDeadline(serverNow)
      const created = await createFlexAutoShift({
        scheduleId,
        userId: current.userId,
        fullName,
        checkInAt: serverNow,
        deadlineAt: deadline,
        worksite: { id: site.id, name: site.name },
        sourceRef: normalized.clientEventId,
      })
      try {
        await service.record({ userId: current.userId, email: current.email, role: current.role }, {
          action: 'clock-in',
          clientEventId: normalized.clientEventId,
          clientOccurredAt: serverNow.toISOString(),
          scheduleId,
          objectId: site.id,
          offlineCaptured: false,
          location: normalized.location,
        })
      } catch (error) {
        if (created.created) await deleteFlexAutoShift(scheduleId, current.userId, normalized.clientEventId).catch(() => {})
        throw error
      }
      return json({ saved: true, action: 'clock-in', scheduleId }, 201)
    }

    const scheduleId = String(body.scheduleId || '').trim()
    const timing = scheduleId ? await findScheduleTiming(scheduleId) : null
    if (!timing || timing.source !== 'attendance-flex' || timing.employeeUserId !== current.userId || !timing.objectId) {
      return json({ message: 'Der automatisch erzeugte Dienst wurde nicht gefunden.', code: 'FLEX_SHIFT_NOT_FOUND' }, 404)
    }
    await service.record({ userId: current.userId, email: current.email, role: current.role }, {
      action: 'clock-out',
      clientEventId: normalized.clientEventId,
      clientOccurredAt: serverNow.toISOString(),
      scheduleId: timing.id,
      objectId: timing.objectId,
      offlineCaptured: false,
      location: normalized.location,
    })
    await finishFlexAutoShift(timing.id, current.userId, serverNow)
    return json({ saved: true, action: 'clock-out', scheduleId: timing.id }, 201)
  } catch (error) {
    if (error instanceof AttendanceServiceError) return json({ message: error.message, code: error.code }, error.status)
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message, code: 'INVALID_INPUT' }, 400)
    console.error('Habun flex attendance', error)
    return json({ message: 'Die Flex-Zeiterfassung konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-flex' }
