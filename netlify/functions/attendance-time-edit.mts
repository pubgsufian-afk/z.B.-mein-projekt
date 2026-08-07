import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { eventDateInBerlin } from './_shared/daily-attendance-service.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

type EventAction = 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
type EventRow = {
  id: string
  user_id: string
  client_event_id: string
  action: EventAction
  server_occurred_at: string | Date
  client_occurred_at: string | Date
  event_date: string | Date
  schedule_id: string | null
  object_id: string | null
  pause_minutes_adjustment: number | null
}
type Session = {
  clockIn: EventRow
  clockOut: EventRow | null
  breakEvents: EventRow[]
  activeBreak: EventRow | null
  pauseMinutes: number
}

const DIRECT_TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])
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

async function connection() {
  const url = databaseConnectionString()
  if (!url) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

function parseRequiredDate(value: unknown, label: string) {
  const text = String(value || '').trim()
  const date = new Date(text)
  if (!text || !Number.isFinite(date.getTime())) throw new TypeError(`${label} ist kein gültiger Zeitpunkt.`)
  return date
}

function parseOptionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  return parseRequiredDate(value, label)
}

function parsePause(value: unknown) {
  const pause = Number(value)
  if (!Number.isFinite(pause) || !Number.isInteger(pause) || pause < 0) {
    throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
  }
  return pause
}

function occurredAt(event: EventRow) {
  return new Date(event.client_occurred_at).getTime()
}

function buildSessions(events: EventRow[]) {
  const ordered = [...events].sort((left, right) => {
    const byClient = occurredAt(left) - occurredAt(right)
    if (byClient) return byClient
    const byServer = new Date(left.server_occurred_at).getTime() - new Date(right.server_occurred_at).getTime()
    if (byServer) return byServer
    return left.id.localeCompare(right.id)
  })
  const sessions: Session[] = []
  let current: Session | null = null

  for (const event of ordered) {
    if (event.action === 'clock-in') {
      if (current) sessions.push(current)
      current = { clockIn: event, clockOut: null, breakEvents: [], activeBreak: null, pauseMinutes: 0 }
      continue
    }
    if (!current) continue
    if (event.action === 'break-start') {
      current.breakEvents.push(event)
      current.activeBreak = event
      continue
    }
    if (event.action === 'break-end') {
      current.breakEvents.push(event)
      if (current.activeBreak) {
        current.pauseMinutes += Math.max(0, Math.round((occurredAt(event) - occurredAt(current.activeBreak)) / 60000))
      }
      current.activeBreak = null
      continue
    }
    if (event.action === 'clock-out') {
      current.clockOut = event
      if (event.pause_minutes_adjustment !== null && event.pause_minutes_adjustment !== undefined) {
        current.pauseMinutes = Math.max(0, Number(event.pause_minutes_adjustment) || 0)
      }
      sessions.push(current)
      current = null
    }
  }
  if (current) sessions.push(current)
  return sessions
}

function ensureExistingBreaksStayInside(session: Session, newStart: Date, newEnd: Date | null) {
  const startMs = newStart.getTime()
  const endMs = newEnd?.getTime() ?? Number.POSITIVE_INFINITY
  const outside = session.breakEvents.some((event) => {
    const time = occurredAt(event)
    return !Number.isFinite(time) || time < startMs || time > endMs
  })
  if (outside) {
    throw Object.assign(new Error('Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.'), { status: 409 })
  }
}

function syntheticBreakEnd(activeBreak: EventRow | null, requestedEnd: Date | null) {
  if (!activeBreak || !requestedEnd) return null
  const breakStart = occurredAt(activeBreak)
  const end = requestedEnd.getTime()
  if (!Number.isFinite(breakStart) || end <= breakStart) {
    throw Object.assign(new Error('Das Arbeitsende muss nach dem Beginn der laufenden Pause liegen.'), { status: 409 })
  }
  const gap = end - breakStart
  return new Date(end - Math.min(1000, Math.max(1, Math.floor(gap / 2))))
}

async function editExistingCompletedSession(
  sql: Awaited<ReturnType<typeof connection>>,
  current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>,
  session: Session,
  newStart: Date,
  newEnd: Date,
  pauseMinutes: number,
  reason: string,
) {
  const now = new Date().toISOString()
  const originalStart = new Date(session.clockIn.client_occurred_at)
  const originalEnd = new Date(session.clockOut!.client_occurred_at)
  const before = {
    clockInAt: originalStart.toISOString(),
    clockOutAt: originalEnd.toISOString(),
    pauseMinutes: session.pauseMinutes,
  }
  const after = {
    clockInAt: newStart.toISOString(),
    clockOutAt: newEnd.toISOString(),
    pauseMinutes,
  }
  const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`

  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ),
     state_ok AS MATERIALIZED (
       SELECT
         EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
              AND e.client_occurred_at = $16::timestamptz
         )
         AND EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.id = $3 AND e.user_id = $1 AND e.action = 'clock-out'
              AND e.client_occurred_at = $17::timestamptz
         ) AS ok
     ),
     updated_clock_in AS (
       UPDATE attendance_events e
          SET client_occurred_at = $4::timestamptz, event_date = $5::date
         FROM state_ok
        WHERE state_ok.ok AND e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
       RETURNING e.id
     ),
     updated_clock_out AS (
       UPDATE attendance_events e
          SET client_occurred_at = $6::timestamptz, event_date = $7::date
         FROM state_ok
        WHERE state_ok.ok AND e.id = $3 AND e.user_id = $1 AND e.action = 'clock-out'
       RETURNING e.id
     ),
     created_adjustment AS (
       INSERT INTO attendance_adjustments
         (id, event_id, user_id, event_date, pause_minutes, reason,
          actor_id, actor_email, actor_role, occurred_at, expires_at)
       SELECT $8, $3, $1, $7::date, $9, $10, $11, $12, $13,
              $14::timestamptz, $14::timestamptz + interval '24 months'
         FROM updated_clock_in, updated_clock_out
       RETURNING id
     ),
     created_audit AS (
       INSERT INTO attendance_audit_log
         (id, occurred_at, actor_id, actor_email, actor_role, action,
          entity_type, entity_id, reason, before_data, after_data, expires_at)
       SELECT $15, $14::timestamptz, $11, $12, $13, 'admin-time-edit',
              'attendance_session', $2 || ':' || $3, $10, $18::jsonb, $19::jsonb,
              $14::timestamptz + interval '24 months'
         FROM created_adjustment
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM created_audit) AS saved`,
    [
      session.clockIn.user_id,
      session.clockIn.id,
      session.clockOut!.id,
      newStart.toISOString(),
      eventDateInBerlin(newStart),
      newEnd.toISOString(),
      eventDateInBerlin(newEnd),
      adjustmentId,
      pauseMinutes,
      reason,
      current.userId,
      current.email,
      current.role,
      now,
      auditId,
      originalStart.toISOString(),
      originalEnd.toISOString(),
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  )
  if (!rows[0]?.saved) {
    return json({ message: 'Der Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.' }, 409)
  }
  return json({ saved: true, clockInEventId: session.clockIn.id, clockOutEventId: session.clockOut!.id })
}

async function editOpenSessionWithoutEnd(
  sql: Awaited<ReturnType<typeof connection>>,
  current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>,
  session: Session,
  lastKnownEvent: EventRow,
  newStart: Date,
  pauseMinutes: number,
  reason: string,
) {
  if (pauseMinutes !== session.pauseMinutes) {
    return json({ message: 'Bei einem laufenden Dienst kann die Pause erst zusammen mit einem Arbeitsende korrigiert werden.' }, 409)
  }

  const now = new Date().toISOString()
  const originalStart = new Date(session.clockIn.client_occurred_at)
  const before = { clockInAt: originalStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes }
  const after = { clockInAt: newStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes }
  const auditId = `attendance-audit:${crypto.randomUUID()}`

  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ),
     state_ok AS MATERIALIZED (
       SELECT
         EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
              AND e.client_occurred_at = $9::timestamptz
         )
         AND COALESCE((
           SELECT e.id FROM attendance_events e CROSS JOIN lock_user
            WHERE e.user_id = $1
            ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
            LIMIT 1
         ), '') = $3 AS ok
     ),
     updated_clock_in AS (
       UPDATE attendance_events e
          SET client_occurred_at = $4::timestamptz, event_date = $5::date
         FROM state_ok
        WHERE state_ok.ok AND e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
       RETURNING e.id
     ),
     created_audit AS (
       INSERT INTO attendance_audit_log
         (id, occurred_at, actor_id, actor_email, actor_role, action,
          entity_type, entity_id, reason, before_data, after_data, expires_at)
       SELECT $6, $7::timestamptz, $10, $11, $12, 'admin-time-edit',
              'attendance_session', $2 || ':open', $8, $13::jsonb, $14::jsonb,
              $7::timestamptz + interval '24 months'
         FROM updated_clock_in
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM created_audit) AS saved`,
    [
      session.clockIn.user_id,
      session.clockIn.id,
      lastKnownEvent.id,
      newStart.toISOString(),
      eventDateInBerlin(newStart),
      auditId,
      now,
      reason,
      originalStart.toISOString(),
      current.userId,
      current.email,
      current.role,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  )
  if (!rows[0]?.saved) {
    return json({ message: 'Der laufende Dienst wurde zwischenzeitlich verändert. Bitte die Zeiten neu laden.' }, 409)
  }
  return json({ saved: true, clockInEventId: session.clockIn.id, clockOutEventId: null, open: true })
}

async function closeAndEditOpenSession(
  sql: Awaited<ReturnType<typeof connection>>,
  current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>,
  session: Session,
  lastKnownEvent: EventRow,
  newStart: Date,
  newEnd: Date,
  pauseMinutes: number,
  reason: string,
) {
  const now = new Date().toISOString()
  const originalStart = new Date(session.clockIn.client_occurred_at)
  const before = { clockInAt: originalStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes }
  const after = { clockInAt: newStart.toISOString(), clockOutAt: newEnd.toISOString(), pauseMinutes }
  const clockOutId = `attendance:${crypto.randomUUID()}`
  const clockOutClientId = `management-clock-out:${crypto.randomUUID()}`
  const clockOutRequestHash = `management-time-edit:${crypto.randomUUID()}`
  const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`
  const breakEndAt = syntheticBreakEnd(session.activeBreak, newEnd)
  const breakEndId = `attendance:${crypto.randomUUID()}`
  const breakEndClientId = `management-break-end:${crypto.randomUUID()}`
  const breakEndRequestHash = `management-time-edit:${crypto.randomUUID()}`

  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ),
     state_ok AS MATERIALIZED (
       SELECT
         EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
              AND e.client_occurred_at = $20::timestamptz
         )
         AND COALESCE((
           SELECT e.id FROM attendance_events e CROSS JOIN lock_user
            WHERE e.user_id = $1
            ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
            LIMIT 1
         ), '') = $3 AS ok
     ),
     updated_clock_in AS (
       UPDATE attendance_events e
          SET client_occurred_at = $4::timestamptz, event_date = $5::date
         FROM state_ok
        WHERE state_ok.ok AND e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
       RETURNING e.id
     ),
     created_break_end AS (
       INSERT INTO attendance_events
         (id, user_id, client_event_id, request_hash, action, server_occurred_at,
          client_occurred_at, event_date, schedule_id, object_id, location_status,
          offline_captured, expires_at)
       SELECT $6, $1, $7, $8, 'break-end', $9::timestamptz,
              $10::timestamptz, $11::date, $12, $13, 'unavailable', false,
              $9::timestamptz + interval '24 months'
         FROM updated_clock_in
        WHERE $14::boolean
       RETURNING id
     ),
     created_clock_out AS (
       INSERT INTO attendance_events
         (id, user_id, client_event_id, request_hash, action, server_occurred_at,
          client_occurred_at, event_date, schedule_id, object_id, location_status,
          offline_captured, expires_at)
       SELECT $15, $1, $16, $17, 'clock-out', $9::timestamptz,
              $18::timestamptz, $19::date, $12, $13, 'unavailable', false,
              $9::timestamptz + interval '24 months'
         FROM updated_clock_in
       RETURNING id
     ),
     created_adjustment AS (
       INSERT INTO attendance_adjustments
         (id, event_id, user_id, event_date, pause_minutes, reason,
          actor_id, actor_email, actor_role, occurred_at, expires_at)
       SELECT $21, $15, $1, $19::date, $22, $23, $24, $25, $26,
              $9::timestamptz, $9::timestamptz + interval '24 months'
         FROM created_clock_out
       RETURNING id
     ),
     created_audit AS (
       INSERT INTO attendance_audit_log
         (id, occurred_at, actor_id, actor_email, actor_role, action,
          entity_type, entity_id, reason, before_data, after_data, expires_at)
       SELECT $27, $9::timestamptz, $24, $25, $26, 'admin-time-edit',
              'attendance_session', $2 || ':' || $15, $23, $28::jsonb, $29::jsonb,
              $9::timestamptz + interval '24 months'
         FROM created_adjustment
       RETURNING id
     )
     SELECT
       (SELECT count(*)::int FROM created_clock_out) AS created_clock_out,
       (SELECT count(*)::int FROM created_audit) AS saved`,
    [
      session.clockIn.user_id,
      session.clockIn.id,
      lastKnownEvent.id,
      newStart.toISOString(),
      eventDateInBerlin(newStart),
      breakEndId,
      breakEndClientId,
      breakEndRequestHash,
      now,
      breakEndAt?.toISOString() || newEnd.toISOString(),
      eventDateInBerlin(breakEndAt || newEnd),
      session.clockIn.schedule_id,
      session.clockIn.object_id,
      Boolean(breakEndAt),
      clockOutId,
      clockOutClientId,
      clockOutRequestHash,
      newEnd.toISOString(),
      eventDateInBerlin(newEnd),
      originalStart.toISOString(),
      adjustmentId,
      pauseMinutes,
      reason,
      current.userId,
      current.email,
      current.role,
      auditId,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  )
  if (!rows[0]?.saved || !rows[0]?.created_clock_out) {
    return json({ message: 'Der laufende Dienst wurde zwischenzeitlich verändert. Bitte die Zeiten neu laden.' }, 409)
  }
  return json({ saved: true, clockInEventId: session.clockIn.id, clockOutEventId: clockOutId, open: false })
}

async function editTime(request: Request) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!DIRECT_TIME_EDIT_ROLES.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const clockInEventId = String(body.clockInEventId || '').trim()
  const suppliedClockOutEventId = String(body.clockOutEventId || '').trim() || null
  const reason = String(body.reason || '').trim().slice(0, 1000)
  if (!clockInEventId || reason.length < 2) return json({ message: 'Arbeitsbeginn und Begründung sind erforderlich.' }, 400)

  let newStart: Date
  let newEnd: Date | null
  let pauseMinutes: number
  try {
    newStart = parseRequiredDate(body.clockInAt, 'Arbeitsbeginn')
    newEnd = parseOptionalDate(body.clockOutAt, 'Arbeitsende')
    pauseMinutes = parsePause(body.pauseMinutes)
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : 'Ungültige Zeitangaben.' }, 400)
  }

  const now = new Date()
  if (newStart.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return json({ message: 'Der Arbeitsbeginn darf nicht in der Zukunft liegen.' }, 400)
  if (newEnd && newEnd.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return json({ message: 'Das Arbeitsende darf nicht in der Zukunft liegen.' }, 400)
  if (newEnd && newEnd.getTime() <= newStart.getTime()) return json({ message: 'Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.' }, 400)
  if (newEnd) {
    const grossMinutes = Math.max(0, Math.round((newEnd.getTime() - newStart.getTime()) / 60000))
    if (pauseMinutes > grossMinutes) return json({ message: 'Die Pause darf nicht länger als die Arbeitszeit sein.' }, 400)
  }

  let sql: Awaited<ReturnType<typeof connection>>
  try { sql = await connection() } catch (error: any) { return json({ message: error.message }, error.status || 500) }

  try {
    const clockInRows = await sql.query(
      `SELECT e.id, e.user_id, e.client_event_id, e.action, e.server_occurred_at,
              e.client_occurred_at, e.event_date, e.schedule_id, e.object_id,
              a.pause_minutes AS pause_minutes_adjustment
         FROM attendance_events e
         LEFT JOIN LATERAL (
           SELECT adjustment.pause_minutes
             FROM attendance_adjustments adjustment
            WHERE adjustment.event_id = e.id
            ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
         ) a ON true
        WHERE e.id = $1`,
      [clockInEventId],
    ) as EventRow[]
    const selectedClockIn = clockInRows[0]
    if (!selectedClockIn) return json({ message: 'Der ausgewählte Arbeitszeiteintrag wurde nicht gefunden.' }, 404)
    if (selectedClockIn.action !== 'clock-in') return json({ message: 'Der ausgewählte Beginn ist keine gültige Einstempelung.' }, 409)

    const events = await sql.query(
      `SELECT e.id, e.user_id, e.client_event_id, e.action, e.server_occurred_at,
              e.client_occurred_at, e.event_date, e.schedule_id, e.object_id,
              a.pause_minutes AS pause_minutes_adjustment
         FROM attendance_events e
         LEFT JOIN LATERAL (
           SELECT adjustment.pause_minutes
             FROM attendance_adjustments adjustment
            WHERE adjustment.event_id = e.id
            ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
         ) a ON true
        WHERE e.user_id = $1
        ORDER BY e.client_occurred_at, e.server_occurred_at, e.id`,
      [selectedClockIn.user_id],
    ) as EventRow[]
    const sessions = buildSessions(events)
    const index = sessions.findIndex((session) => session.clockIn.id === clockInEventId)
    const session = sessions[index]
    if (!session) return json({ message: 'Der ausgewählte Dienst konnte nicht eindeutig zugeordnet werden.' }, 409)

    if (session.clockOut) {
      if (!suppliedClockOutEventId || suppliedClockOutEventId !== session.clockOut.id) {
        return json({ message: 'Der Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.' }, 409)
      }
      if (!newEnd) return json({ message: 'Bei einem abgeschlossenen Dienst muss ein Arbeitsende eingetragen sein.' }, 400)
      const originalStart = new Date(session.clockIn.client_occurred_at)
      const originalEnd = new Date(session.clockOut.client_occurred_at)
      if (originalStart.getTime() > originalEnd.getTime()) {
        return json({ message: 'Der gespeicherte Arbeitsbeginn liegt nach dem Arbeitsende.' }, 409)
      }
    } else if (suppliedClockOutEventId) {
      return json({ message: 'Der laufende Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.' }, 409)
    }

    const previous = sessions[index - 1]
    const next = sessions[index + 1]
    if (previous?.clockOut && newStart.getTime() < occurredAt(previous.clockOut)) {
      return json({ message: 'Der neue Arbeitsbeginn überschneidet sich mit einem vorherigen Dienst.' }, 409)
    }
    if (newEnd && next && newEnd.getTime() > occurredAt(next.clockIn)) {
      return json({ message: 'Das neue Arbeitsende überschneidet sich mit einem folgenden Dienst.' }, 409)
    }
    if (!newEnd && next) {
      return json({ message: 'Ein laufender Dienst kann nicht über einen folgenden Dienst hinausreichen.' }, 409)
    }

    try {
      ensureExistingBreaksStayInside(session, newStart, newEnd)
    } catch (error: any) {
      return json({ message: error.message }, error.status || 409)
    }

    if (session.clockOut && newEnd) {
      return await editExistingCompletedSession(sql, current, session, newStart, newEnd, pauseMinutes, reason)
    }

    const targetEvents = events.filter((event) => {
      const eventMs = occurredAt(event)
      return eventMs >= occurredAt(session.clockIn) && (!session.clockOut || eventMs <= occurredAt(session.clockOut))
    })
    const lastKnownEvent = targetEvents[targetEvents.length - 1] || session.clockIn
    if (!newEnd) {
      return await editOpenSessionWithoutEnd(sql, current, session, lastKnownEvent, newStart, pauseMinutes, reason)
    }
    return await closeAndEditOpenSession(sql, current, session, lastKnownEvent, newStart, newEnd, pauseMinutes, reason)
  } catch (error) {
    console.error('Habun direct attendance time edit', error)
    return json({ message: 'Die Arbeitszeit konnte nicht geändert werden.' }, 500)
  }
}

export default async function attendanceTimeEdit(request: Request, _context: Context) {
  return editTime(request)
}

export const config: Config = { path: '/api/attendance-time-edit' }
