import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

type EventRow = {
  id: string
  user_id: string
  client_event_id: string
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  schedule_id: string | null
  object_id: string | null
}
type AttendanceSession = {
  clockIn: EventRow
  clockOut: EventRow | null
  breakEvents: EventRow[]
  pauseMinutes: number
}

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

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

async function connection() {
  const url = databaseConnectionString()
  if (!url) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

function parsedDate(value: unknown, label: string) {
  const text = String(value || '').trim()
  const date = new Date(text)
  if (!text || !Number.isFinite(date.getTime())) throw new TypeError(`${label} ist kein gültiger Zeitpunkt.`)
  return date
}

function eventDateInBerlin(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function asTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return date.getTime()
}

export function buildAttendanceSessions(rows: EventRow[]) {
  const ordered = [...rows].sort((left, right) => asTime(left.client_occurred_at) - asTime(right.client_occurred_at))
  const sessions: AttendanceSession[] = []
  let current: AttendanceSession | null = null
  let breakStart: EventRow | null = null

  for (const event of ordered) {
    if (event.action === 'clock-in') {
      if (current) sessions.push(current)
      current = { clockIn: event, clockOut: null, breakEvents: [], pauseMinutes: 0 }
      breakStart = null
      continue
    }
    if (!current) continue
    if (event.action === 'break-start') {
      current.breakEvents.push(event)
      breakStart = event
      continue
    }
    if (event.action === 'break-end') {
      current.breakEvents.push(event)
      if (breakStart) {
        current.pauseMinutes += Math.max(0, Math.round((asTime(event.client_occurred_at) - asTime(breakStart.client_occurred_at)) / 60000))
      }
      breakStart = null
      continue
    }
    if (event.action === 'clock-out') {
      current.clockOut = event
      sessions.push(current)
      current = null
      breakStart = null
    }
  }
  if (current) sessions.push(current)
  return sessions
}

function validatePause(value: unknown) {
  const pause = Number(value)
  if (!Number.isFinite(pause) || !Number.isInteger(pause) || pause < 0) {
    throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
  }
  return pause
}

function editWindow(sessions: AttendanceSession[], index: number, clockInAt: Date, clockOutAt: Date | null, pauseMinutes: number, now: Date) {
  const effectiveEnd = clockOutAt || now
  if (effectiveEnd.getTime() <= clockInAt.getTime()) throw new RangeError('Arbeitsende muss nach dem Arbeitsbeginn liegen.')
  const grossMinutes = Math.floor((effectiveEnd.getTime() - clockInAt.getTime()) / 60000)
  if (pauseMinutes >= grossMinutes) throw new RangeError('Die Pause muss kürzer als die Bruttoarbeitszeit sein.')

  const previous = sessions[index - 1]
  const next = sessions[index + 1]
  if (previous?.clockOut && asTime(previous.clockOut.client_occurred_at) > clockInAt.getTime()) {
    throw new RangeError('Der korrigierte Arbeitsbeginn überschneidet sich mit dem vorherigen Dienst.')
  }
  if (next && clockOutAt && clockOutAt.getTime() > asTime(next.clockIn.client_occurred_at)) {
    throw new RangeError('Das korrigierte Arbeitsende überschneidet sich mit dem nächsten Dienst.')
  }
  if (next && !clockOutAt && now.getTime() > asTime(next.clockIn.client_occurred_at)) {
    throw new RangeError('Ein offener Dienst kann nicht über einen späteren Dienst hinausreichen.')
  }

  const netWithoutPause = effectiveEnd.getTime() - clockInAt.getTime() - pauseMinutes * 60000
  const breakStartAt = pauseMinutes > 0 ? new Date(clockInAt.getTime() + Math.floor(netWithoutPause / 2)) : null
  const breakEndAt = breakStartAt ? new Date(breakStartAt.getTime() + pauseMinutes * 60000) : null
  return { breakStartAt, breakEndAt }
}

async function editSession(
  sql: Awaited<ReturnType<typeof connection>>,
  current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>,
  body: Record<string, unknown>,
) {
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)

  const userId = String(body.userId || '').trim()
  const clockInEventId = String(body.clockInEventId || '').trim()
  if (!userId || !clockInEventId) return json({ message: 'Mitarbeiter und Arbeitsbeginn sind erforderlich.' }, 400)

  const rows = await sql.query(
    `SELECT id, user_id, client_event_id, action, client_occurred_at, event_date, schedule_id, object_id
       FROM attendance_events
      WHERE user_id = $1
      ORDER BY client_occurred_at, server_occurred_at, id`,
    [userId],
  ) as EventRow[]
  const sessions = buildAttendanceSessions(rows)
  const sessionIndex = sessions.findIndex((item) => item.clockIn.id === clockInEventId)
  const session = sessions[sessionIndex]
  if (!session) return json({ message: 'Der ausgewählte Dienst wurde nicht gefunden.' }, 404)

  const suppliedClockOutId = String(body.clockOutEventId || '').trim()
  if (suppliedClockOutId && suppliedClockOutId !== session.clockOut?.id) {
    return json({ message: 'Der Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.' }, 409)
  }

  const newClockIn = parsedDate(body.clockInAt, 'Arbeitsbeginn')
  let newClockOut: Date | null = null
  if (body.clockOutAt !== undefined && body.clockOutAt !== null && String(body.clockOutAt).trim()) {
    newClockOut = parsedDate(body.clockOutAt, 'Arbeitsende')
  } else if (session.clockOut) {
    newClockOut = new Date(session.clockOut.client_occurred_at)
  }

  const pauseMinutes = validatePause(body.pauseMinutes)
  const now = new Date()
  const window = editWindow(sessions, sessionIndex, newClockIn, newClockOut, pauseMinutes, now)
  const createClockOut = !session.clockOut && Boolean(newClockOut)
  const reason = String(body.reason || '').trim().slice(0, 1000) || 'Manuelle Korrektur der Arbeitszeit'
  const sessionDate = eventDateInBerlin(newClockIn)

  const originalStart = new Date(session.clockIn.client_occurred_at)
  const originalEnd = session.clockOut ? new Date(session.clockOut.client_occurred_at) : null
  const before = {
    eventId: session.clockIn.id,
    clockInAt: originalStart.toISOString(),
    clockOutAt: originalEnd?.toISOString() || null,
    pauseMinutes: session.pauseMinutes,
  }
  const after = {
    eventId: session.clockIn.id,
    clockInAt: newClockIn.toISOString(),
    clockOutAt: newClockOut?.toISOString() || null,
    pauseMinutes,
  }

  const breakStartId = `attendance:${crypto.randomUUID()}`
  const breakStartClientId = `management-break-start:${crypto.randomUUID()}`
  const breakEndId = `attendance:${crypto.randomUUID()}`
  const breakEndClientId = `management-break-end:${crypto.randomUUID()}`
  const createdOutId = `attendance:${crypto.randomUUID()}`
  const createdOutClientId = `management-clock-out:${crypto.randomUUID()}`
  const nowIso = now.toISOString()

  const result = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ),
     source_in AS MATERIALIZED (
       SELECT e.id, e.schedule_id, e.object_id
         FROM attendance_events e CROSS JOIN lock_user
        WHERE e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
     ),
     source_out AS MATERIALIZED (
       SELECT e.id
         FROM attendance_events e CROSS JOIN lock_user
        WHERE $3::text IS NOT NULL AND e.id = $3 AND e.user_id = $1 AND e.action = 'clock-out'
     ),
     updated_in AS (
       UPDATE attendance_events e
          SET client_occurred_at = $4::timestamptz,
              event_date = $6::date
        WHERE e.id = (SELECT id FROM source_in)
        RETURNING e.id
     ),
     updated_in_location AS (
       UPDATE attendance_locations l
          SET captured_at = $4::timestamptz
        WHERE l.event_id = (SELECT id FROM source_in)
        RETURNING l.event_id
     ),
     updated_out AS (
       UPDATE attendance_events e
          SET client_occurred_at = $5::timestamptz,
              event_date = $6::date
        WHERE $3::text IS NOT NULL
          AND $5::text IS NOT NULL
          AND e.id = (SELECT id FROM source_out)
        RETURNING e.id
     ),
     updated_out_location AS (
       UPDATE attendance_locations l
          SET captured_at = $5::timestamptz
        WHERE $3::text IS NOT NULL
          AND $5::text IS NOT NULL
          AND l.event_id = (SELECT id FROM source_out)
        RETURNING l.event_id
     ),
     deleted_breaks AS (
       DELETE FROM attendance_events e
        WHERE e.user_id = $1
          AND e.action IN ('break-start', 'break-end')
          AND e.client_occurred_at >= $8::timestamptz
          AND e.client_occurred_at <= CASE WHEN $3::text IS NULL THEN now() ELSE $9::timestamptz END
        RETURNING e.id
     ),
     created_out AS (
       INSERT INTO attendance_events
         (id, user_id, client_event_id, request_hash, action, server_occurred_at,
          client_occurred_at, event_date, schedule_id, object_id, location_status,
          offline_captured, expires_at)
       SELECT $20, $1, $21, $22, 'clock-out', $7::timestamptz,
              $5::timestamptz, $6::date, s.schedule_id, s.object_id, 'unavailable',
              false, $7::timestamptz + interval '24 months'
         FROM source_in s
        WHERE $19::boolean
          AND NOT EXISTS (
            SELECT 1 FROM attendance_events existing
             WHERE existing.user_id = $1
               AND existing.action = 'clock-out'
               AND existing.client_occurred_at >= $8::timestamptz
               AND existing.client_occurred_at <= $7::timestamptz
          )
       RETURNING id
     ),
     created_break_start AS (
       INSERT INTO attendance_events
         (id, user_id, client_event_id, request_hash, action, server_occurred_at,
          client_occurred_at, event_date, schedule_id, object_id, location_status,
          offline_captured, expires_at)
       SELECT $11, $1, $12, $13, 'break-start', $7::timestamptz,
              $14::timestamptz, $6::date, s.schedule_id, s.object_id, 'unavailable',
              false, $7::timestamptz + interval '24 months'
         FROM source_in s
        WHERE $10::boolean
       RETURNING id
     ),
     created_break_end AS (
       INSERT INTO attendance_events
         (id, user_id, client_event_id, request_hash, action, server_occurred_at,
          client_occurred_at, event_date, schedule_id, object_id, location_status,
          offline_captured, expires_at)
       SELECT $15, $1, $16, $17, 'break-end', $7::timestamptz,
              $18::timestamptz, $6::date, s.schedule_id, s.object_id, 'unavailable',
              false, $7::timestamptz + interval '24 months'
         FROM source_in s
        WHERE $10::boolean
       RETURNING id
     ),
     created_audit AS (
       INSERT INTO attendance_audit_log
         (id, occurred_at, actor_id, actor_email, actor_role, action,
          entity_type, entity_id, reason, before_data, after_data, expires_at)
       SELECT $29, $7::timestamptz, $23, $24, $25, 'management-time-edit',
              'attendance_session', $2, $26, $27::jsonb, $28::jsonb,
              $7::timestamptz + interval '24 months'
        WHERE EXISTS (SELECT 1 FROM updated_in)
       RETURNING id
     )
     SELECT
       (SELECT count(*)::int FROM updated_in) AS updated_in,
       (SELECT count(*)::int FROM updated_out) AS updated_out,
       (SELECT count(*)::int FROM created_out) AS created_out,
       (SELECT count(*)::int FROM deleted_breaks) AS deleted_breaks,
       (SELECT count(*)::int FROM created_break_start) AS created_break_start,
       (SELECT count(*)::int FROM created_break_end) AS created_break_end,
       (SELECT count(*)::int FROM created_audit) AS audited`,
    [
      userId,
      session.clockIn.id,
      session.clockOut?.id || null,
      newClockIn.toISOString(),
      newClockOut?.toISOString() || null,
      sessionDate,
      nowIso,
      originalStart.toISOString(),
      originalEnd?.toISOString() || nowIso,
      pauseMinutes > 0,
      breakStartId,
      breakStartClientId,
      `management-edit:${breakStartId}`,
      window.breakStartAt?.toISOString() || null,
      breakEndId,
      breakEndClientId,
      `management-edit:${breakEndId}`,
      window.breakEndAt?.toISOString() || null,
      createClockOut,
      createdOutId,
      createdOutClientId,
      `management-edit:${createdOutId}`,
      current.userId,
      current.email,
      current.role,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      `attendance-audit:${crypto.randomUUID()}`,
    ],
  )

  const summary = result[0] || {}
  if (!summary.updated_in) return json({ message: 'Der Dienst konnte nicht mehr eindeutig aktualisiert werden. Bitte neu laden.' }, 409)
  if (session.clockOut && !summary.updated_out) return json({ message: 'Das Arbeitsende wurde zwischenzeitlich geändert. Bitte neu laden.' }, 409)
  if (createClockOut && !summary.created_out) return json({ message: 'Das Arbeitsende wurde zwischenzeitlich bereits gebucht. Bitte neu laden.' }, 409)

  return json({
    saved: true,
    userId,
    clockInEventId: session.clockIn.id,
    clockOutEventId: session.clockOut?.id || (createClockOut ? createdOutId : null),
    clockInAt: newClockIn.toISOString(),
    clockOutAt: newClockOut?.toISOString() || null,
    pauseMinutes,
  })
}

export default async function attendanceEdit(request: Request, _context: Context) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)

  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  if (String(body.action || '') !== 'edit-session') return json({ message: 'Unbekannte Aktion.' }, 400)

  let sql
  try { sql = await connection() } catch (error: any) { return json({ message: error.message }, error.status || 500) }
  try {
    return await editSession(sql, current, body)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message }, 400)
    console.error('Habun attendance edit', error)
    return json({ message: 'Die Arbeitszeit konnte nicht korrigiert werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-edit' }
