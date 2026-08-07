import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { eventDateInBerlin } from './_shared/daily-attendance-service.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

const DIRECT_TIME_CREATE_ROLES = new Set(['owner', 'admin', 'manager'])
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

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

function parseRequiredDate(value: unknown, label: string) {
  const text = String(value || '').trim()
  const date = new Date(text)
  if (!text || !Number.isFinite(date.getTime())) throw new TypeError(`${label} ist kein gültiger Zeitpunkt.`)
  return date
}

function parsePause(value: unknown) {
  const pause = Number(value)
  if (!Number.isFinite(pause) || !Number.isInteger(pause) || pause < 0) throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
  return pause
}

async function createManualTime(request: Request) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!DIRECT_TIME_CREATE_ROLES.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const userId = String(body.userId || '').trim()
  if (!userId) return json({ message: 'Bitte einen Mitarbeiter auswählen.' }, 400)

  let clockInAt: Date
  let clockOutAt: Date
  let pauseMinutes: number
  try {
    clockInAt = parseRequiredDate(body.clockInAt, 'Arbeitsbeginn')
    clockOutAt = parseRequiredDate(body.clockOutAt, 'Arbeitsende')
    pauseMinutes = parsePause(body.pauseMinutes)
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : 'Ungültige Zeitangaben.' }, 400)
  }

  if (clockOutAt.getTime() <= clockInAt.getTime()) return json({ message: 'Das Arbeitsende muss nach dem Arbeitsbeginn liegen.' }, 400)
  const now = Date.now()
  if (clockInAt.getTime() > now + FUTURE_TOLERANCE_MS || clockOutAt.getTime() > now + FUTURE_TOLERANCE_MS) {
    return json({ message: 'Arbeitszeiten dürfen nicht in der Zukunft liegen.' }, 400)
  }
  const grossMinutes = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000)
  if (pauseMinutes > grossMinutes) return json({ message: 'Die Pause darf nicht länger als die Arbeitszeit sein.' }, 400)

  const connection = databaseConnectionString()
  if (!connection) return json({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.' }, 503)

  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(connection)
    const serverNow = new Date().toISOString()
    const clockInEventId = `attendance:${crypto.randomUUID()}`
    const clockOutEventId = `attendance:${crypto.randomUUID()}`
    const clockInClientId = `management-clock-in:${crypto.randomUUID()}`
    const clockOutClientId = `management-clock-out:${crypto.randomUUID()}`
    const clockInHash = `manual-timesheet:${crypto.randomUUID()}`
    const clockOutHash = `manual-timesheet:${crypto.randomUUID()}`
    const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
    const auditId = `attendance-audit:${crypto.randomUUID()}`
    const scheduleId = String(body.scheduleId || '').trim() || null
    const objectId = String(body.objectId || '').trim() || null
    const reason = 'Manueller Stundenzettel-Eintrag'
    const after = JSON.stringify({
      userId,
      clockInAt: clockInAt.toISOString(),
      clockOutAt: clockOutAt.toISOString(),
      pauseMinutes,
      scheduleId,
      objectId,
    })

    const rows = await sql.query(
      `WITH lock_user AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
       ),
       latest_before AS MATERIALIZED (
         SELECT e.action
           FROM attendance_events e CROSS JOIN lock_user
          WHERE e.user_id = $1 AND e.client_occurred_at < $2::timestamptz
          ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
          LIMIT 1
       ),
       conflict AS MATERIALIZED (
         SELECT
           EXISTS (
             SELECT 1 FROM attendance_events e CROSS JOIN lock_user
              WHERE e.user_id = $1
                AND e.client_occurred_at >= $2::timestamptz
                AND e.client_occurred_at <= $3::timestamptz
           )
           OR COALESCE((SELECT action FROM latest_before), 'clock-out') <> 'clock-out' AS overlap
       ),
       created_clock_in AS (
         INSERT INTO attendance_events
           (id, user_id, client_event_id, request_hash, action, server_occurred_at,
            client_occurred_at, event_date, schedule_id, object_id, location_status,
            offline_captured, expires_at)
         SELECT $4, $1, $5, $6, 'clock-in', $7::timestamptz,
                $2::timestamptz, $8::date, $9, $10, 'unavailable', false,
                $7::timestamptz + interval '24 months'
           FROM conflict
          WHERE NOT overlap
         RETURNING id
       ),
       created_clock_out AS (
         INSERT INTO attendance_events
           (id, user_id, client_event_id, request_hash, action, server_occurred_at,
            client_occurred_at, event_date, schedule_id, object_id, location_status,
            offline_captured, expires_at)
         SELECT $11, $1, $12, $13, 'clock-out', $7::timestamptz,
                $3::timestamptz, $14::date, $9, $10, 'unavailable', false,
                $7::timestamptz + interval '24 months'
           FROM created_clock_in
         RETURNING id
       ),
       created_adjustment AS (
         INSERT INTO attendance_adjustments
           (id, event_id, user_id, event_date, pause_minutes, reason,
            actor_id, actor_email, actor_role, occurred_at, expires_at)
         SELECT $15, $11, $1, $14::date, $16, $17, $18, $19, $20,
                $7::timestamptz, $7::timestamptz + interval '24 months'
           FROM created_clock_out
         RETURNING id
       ),
       created_audit AS (
         INSERT INTO attendance_audit_log
           (id, occurred_at, actor_id, actor_email, actor_role, action,
            entity_type, entity_id, reason, before_data, after_data, expires_at)
         SELECT $21, $7::timestamptz, $18, $19, $20, 'admin-time-create',
                'attendance_session', $4 || ':' || $11, $17, NULL, $22::jsonb,
                $7::timestamptz + interval '24 months'
           FROM created_adjustment
         RETURNING id
       )
       SELECT
         (SELECT overlap FROM conflict) AS overlap,
         (SELECT count(*)::int FROM created_clock_in) AS created_clock_in,
         (SELECT count(*)::int FROM created_clock_out) AS created_clock_out,
         (SELECT count(*)::int FROM created_audit) AS saved`,
      [
        userId,
        clockInAt.toISOString(),
        clockOutAt.toISOString(),
        clockInEventId,
        clockInClientId,
        clockInHash,
        serverNow,
        eventDateInBerlin(clockInAt),
        scheduleId,
        objectId,
        clockOutEventId,
        clockOutClientId,
        clockOutHash,
        eventDateInBerlin(clockOutAt),
        adjustmentId,
        pauseMinutes,
        reason,
        current.userId,
        current.email,
        current.role,
        auditId,
        after,
      ],
    )

    const result = rows[0]
    if (result?.overlap) return json({ message: 'Die neue Arbeitszeit überschneidet sich mit einer vorhandenen Buchung.' }, 409)
    if (!result?.saved || !result?.created_clock_in || !result?.created_clock_out) {
      return json({ message: 'Die Arbeitszeit konnte nicht vollständig gespeichert werden.' }, 409)
    }
    return json({ saved: true, created: true, clockInEventId, clockOutEventId }, 201)
  } catch (error) {
    console.error('Habun manual timesheet entry', error)
    return json({ message: 'Die Arbeitszeit konnte nicht eingetragen werden.' }, 500)
  }
}

export default async function attendanceTimeCreate(request: Request, _context: Context) {
  return createManualTime(request)
}

export const config: Config = { path: '/api/attendance-time-create' }
