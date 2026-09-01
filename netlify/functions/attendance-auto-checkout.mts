import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { createAttendanceService } from './_shared/attendance-service.mts'
import { createAttendanceRepository } from './_shared/neon-attendance.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import {
  autoEventId,
  flexCheckoutDeadline,
  normalCheckoutDeadline,
} from './_shared/attendance-automation-policy.mts'
import {
  findScheduleTiming,
  finishFlexAutoShift,
  nextPublishedShiftStart,
  writeAutomationScheduleAudit,
} from './_shared/attendance-auto-shift.mts'

type OpenSession = {
  userId: string
  phase: 'working' | 'paused'
  clockInAt: string
  latestAt: string
  scheduleId: string | null
  objectId: string | null
}

type ScheduleTiming = {
  source: string
  scheduledEndAt: string
}

export function checkoutDeadlineForSession(session: Pick<OpenSession, 'clockInAt'>, timing: ScheduleTiming) {
  return timing.source === 'attendance-flex'
    ? flexCheckoutDeadline(session.clockInAt)
    : normalCheckoutDeadline(timing.scheduledEndAt)
}

export function automaticActionsForPhase(phase: string) {
  return phase === 'paused' ? ['break-end', 'clock-out'] : ['clock-out']
}

async function listOpenSessions(userId: string | null = null): Promise<OpenSession[]> {
  const database = getDatabase()
  const result = await database.pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.user_id)
              e.user_id, e.action, e.client_occurred_at, e.schedule_id, e.object_id
         FROM attendance_events e
        WHERE ($1::text IS NULL OR e.user_id = $1::text)
        ORDER BY e.user_id, e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
     )
     SELECT l.user_id, l.action, l.client_occurred_at AS latest_at, l.schedule_id, l.object_id,
            start_event.client_occurred_at AS clock_in_at
       FROM latest l
       JOIN LATERAL (
         SELECT e.client_occurred_at
           FROM attendance_events e
          WHERE e.user_id = l.user_id
            AND e.action = 'clock-in'
            AND e.client_occurred_at <= l.client_occurred_at
          ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
          LIMIT 1
       ) start_event ON true
      WHERE l.action IN ('clock-in', 'break-start', 'break-end')
      ORDER BY l.user_id`,
    [userId],
  )
  return result.rows.map((row) => ({
    userId: String(row.user_id),
    phase: row.action === 'break-start' ? 'paused' : 'working',
    clockInAt: new Date(row.clock_in_at).toISOString(),
    latestAt: new Date(row.latest_at).toISOString(),
    scheduleId: row.schedule_id == null ? null : String(row.schedule_id),
    objectId: row.object_id == null ? null : String(row.object_id),
  }))
}

async function runAutoCheckout(userId: string | null, now = new Date()) {
  const connectionString = databaseConnectionString()
  if (!connectionString) {
    console.error('Attendance auto-checkout skipped: database is not configured')
    return { checked: 0, checkedOut: 0 }
  }

  const repository = await createAttendanceRepository(connectionString)
  const service = createAttendanceService({ repository })
  let sessions: OpenSession[] = []
  try {
    sessions = await listOpenSessions(userId)
  } catch (error) {
    console.error('Attendance auto-checkout open-session lookup failed', error)
    return { checked: 0, checkedOut: 0 }
  }

  let checkedOut = 0
  for (const session of sessions) {
    if (!session.scheduleId) continue
    try {
      const timing = await findScheduleTiming(session.scheduleId)
      if (!timing || timing.employeeUserId !== session.userId) continue
      const deadline = checkoutDeadlineForSession(session, timing)
      if (now.getTime() < deadline.getTime()) continue

      const nextStart = await nextPublishedShiftStart(session.userId, timing.scheduledStartAt)
      if (nextStart && new Date(nextStart).getTime() <= deadline.getTime()) {
        await writeAutomationScheduleAudit('auto-checkout-conflict', timing.id, {
          employeeUserId: session.userId,
          deadline: deadline.toISOString(),
          nextShiftStart: nextStart,
        })
        continue
      }

      const systemActor = {
        userId: session.userId,
        actorId: 'system:auto-checkout',
        email: 'system@habun.invalid',
        role: 'system',
      }
      for (const action of automaticActionsForPhase(session.phase)) {
        await service.record(systemActor, {
          action,
          clientEventId: autoEventId(action, session.userId, deadline),
          clientOccurredAt: deadline.toISOString(),
          scheduleId: timing.id,
          objectId: timing.objectId || session.objectId,
          offlineCaptured: false,
          location: null,
        })
      }
      if (timing.source === 'attendance-flex') {
        await finishFlexAutoShift(timing.id, session.userId, deadline)
      }
      checkedOut += 1
    } catch (error) {
      console.error('Attendance auto-checkout session failed', { userId: session.userId, scheduleId: session.scheduleId, error })
    }
  }
  return { checked: sessions.length, checkedOut }
}

export async function runAutoCheckoutForUser(userId: string, now = new Date()) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) throw new TypeError('Benutzer-ID ist erforderlich.')
  return runAutoCheckout(normalizedUserId, now)
}

export default async function attendanceAutoCheckout(_request: Request, _context: Context) {
  await runAutoCheckout(null, new Date())
}

export const config: Config = { schedule: '@daily' }
