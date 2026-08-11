import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { eventDateInBerlin } from './_shared/daily-attendance-service.mts'
import { listScheduleShifts } from './_shared/schedule-neon-repository.mts'
import {
  detectAttendanceDuplicates,
  validateAttendanceSessionEdit,
  type AttendanceEmployeeSnapshot,
  type AttendanceEventSnapshot,
} from './_shared/attendance-assistant-core.mts'

const ASSISTANT_ACTOR_ID = 'attendance-assistant'
const ASSISTANT_ACTOR_EMAIL = 'attendance-assistant@internal.invalid'
const ASSISTANT_ACTOR_ROLE = 'admin'
const MAX_ATTENDANCE_RANGE_DAYS = 62

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

function text(value: unknown) {
  return String(value ?? '').trim()
}

function authorized(request: Request) {
  const expected = text(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN'))
  const supplied = text(request.headers.get('authorization'))
  return Boolean(expected) && supplied === `Bearer ${expected}`
}

async function connection() {
  const url = databaseConnectionString()
  if (!url) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

function validAttendanceRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return false
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false
  const inclusiveDays = Math.floor((toMs - fromMs) / 86400000) + 1
  return inclusiveDays >= 1 && inclusiveDays <= MAX_ATTENDANCE_RANGE_DAYS
}

function eventSnapshot(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    clientEventId: text(row.client_event_id),
    action: text(row.action),
    serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(),
    clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString(),
    eventDate: String(row.event_date).slice(0, 10),
    scheduleId: text(row.schedule_id),
    objectId: text(row.object_id),
    locationStatus: text(row.location_status),
    offlineCaptured: row.offline_captured === true,
  }
}

function adjustmentSnapshot(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    eventId: text(row.event_id),
    userId: text(row.user_id),
    eventDate: String(row.event_date).slice(0, 10),
    pauseMinutes: Number(row.pause_minutes || 0),
    reason: text(row.reason),
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
  }
}

function employeeSnapshot(row: Record<string, unknown>) {
  return {
    userId: text(row.user_id),
    fullName: text(row.full_name),
    role: text(row.role),
    status: text(row.status),
    location: text(row.location),
    syncedAt: row.synced_at ? new Date(String(row.synced_at)).toISOString() : '',
  }
}

async function listAttendanceData(sql: Awaited<ReturnType<typeof connection>>, from: string, to: string) {
  const scheduleDatabase = getDatabase()
  const [eventRows, adjustmentRows, shifts, employeeResult] = await Promise.all([
    sql.query(
      `SELECT id, user_id, client_event_id, action, server_occurred_at, client_occurred_at,
              event_date, schedule_id, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date
        ORDER BY user_id, event_date, client_occurred_at, server_occurred_at, id`,
      [from, to],
    ),
    sql.query(
      `SELECT DISTINCT ON (event_id)
              id, event_id, user_id, event_date, pause_minutes, reason, occurred_at
         FROM attendance_adjustments
        WHERE event_date BETWEEN $1::date AND $2::date
        ORDER BY event_id, occurred_at DESC, id DESC`,
      [from, to],
    ),
    listScheduleShifts({ from, to }),
    scheduleDatabase.pool.query(
      `SELECT user_id, full_name, role, status, location, synced_at
         FROM schedule_employees
        ORDER BY lower(full_name), user_id`,
    ),
  ])

  const events = eventRows.map((row) => eventSnapshot(row as Record<string, unknown>))
  const adjustments = adjustmentRows.map((row) => adjustmentSnapshot(row as Record<string, unknown>))
  const employees = employeeResult.rows.map((row) => employeeSnapshot(row as Record<string, unknown>))
  return {
    from,
    to,
    events,
    adjustments,
    shifts,
    employees,
    counts: {
      events: events.length,
      adjustments: adjustments.length,
      shifts: shifts.length,
      employees: employees.length,
    },
  }
}

function minutesFromBreakEvents(rows: Array<Record<string, unknown>>) {
  let startedAt: Date | null = null
  let total = 0
  for (const row of rows) {
    if (row.action === 'break-start') startedAt = new Date(String(row.client_occurred_at))
    if (row.action === 'break-end' && startedAt) {
      const endedAt = new Date(String(row.client_occurred_at))
      if (Number.isFinite(endedAt.getTime()) && Number.isFinite(startedAt.getTime())) {
        total += Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000))
      }
      startedAt = null
    }
  }
  return total
}

async function updateAttendanceSession(sql: Awaited<ReturnType<typeof connection>>, body: Record<string, unknown>) {
  const clockInEventId = text(body.clockInEventId)
  const clockOutEventId = text(body.clockOutEventId)
  const reason = text(body.reason)
  if (!clockInEventId || !clockOutEventId || reason.length < 2) return json({ message: 'Beginn, Ende und Begründung sind erforderlich.' }, 400)

  let requested
  try {
    requested = validateAttendanceSessionEdit(body)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message }, 400)
    throw error
  }
  const clockInAt = new Date(requested.clockInAt)
  const clockOutAt = new Date(requested.clockOutAt)
  const pauseMinutes = requested.pauseMinutes

  const [clockInRows, clockOutRows] = await Promise.all([
    sql.query(`SELECT id, user_id, action, client_occurred_at, event_date FROM attendance_events WHERE id = $1`, [clockInEventId]),
    sql.query(`SELECT id, user_id, action, client_occurred_at, event_date FROM attendance_events WHERE id = $1`, [clockOutEventId]),
  ])
  const clockInEvent = clockInRows[0]
  const clockOutEvent = clockOutRows[0]
  if (!clockInEvent || !clockOutEvent) return json({ message: 'Der ausgewählte Arbeitszeiteintrag wurde nicht gefunden.' }, 404)
  if (clockInEvent.action !== 'clock-in' || clockOutEvent.action !== 'clock-out' || clockInEvent.user_id !== clockOutEvent.user_id) {
    return json({ message: 'Beginn und Ende gehören nicht zum selben gültigen Arbeitszeiteintrag.' }, 409)
  }

  const holds = await sql.query(
    `SELECT entity_id FROM attendance_legal_holds
      WHERE entity_type = 'attendance_event' AND held = true AND entity_id = ANY($1::text[])`,
    [[clockInEventId, clockOutEventId]],
  )
  if (holds.length) return json({ message: 'Mindestens eine Buchung steht unter Aufbewahrungsschutz.' }, 409)

  const originalClockInAt = new Date(clockInEvent.client_occurred_at)
  const originalClockOutAt = new Date(clockOutEvent.client_occurred_at)
  if (originalClockInAt.getTime() > originalClockOutAt.getTime()) return json({ message: 'Der gespeicherte Arbeitsbeginn liegt nach dem Arbeitsende.' }, 409)

  const betweenBoundaries = await sql.query(
    `SELECT id FROM attendance_events
      WHERE user_id = $1
        AND client_occurred_at > $2::timestamptz
        AND client_occurred_at < $3::timestamptz
        AND action IN ('clock-in','clock-out')
      LIMIT 1`,
    [clockInEvent.user_id, clockInEvent.client_occurred_at, clockOutEvent.client_occurred_at],
  )
  if (betweenBoundaries[0]) return json({ message: 'Beginn und Ende gehören nicht zum selben Dienst.' }, 409)

  const neighbors = await sql.query(
    `SELECT
       (SELECT client_occurred_at FROM attendance_events
         WHERE user_id = $1 AND action = 'clock-out' AND client_occurred_at < $2::timestamptz
         ORDER BY client_occurred_at DESC LIMIT 1) AS previous_end,
       (SELECT client_occurred_at FROM attendance_events
         WHERE user_id = $1 AND action = 'clock-in' AND client_occurred_at > $3::timestamptz
         ORDER BY client_occurred_at ASC LIMIT 1) AS next_start`,
    [clockInEvent.user_id, clockInEvent.client_occurred_at, clockOutEvent.client_occurred_at],
  )
  const previousEnd = neighbors[0]?.previous_end ? new Date(neighbors[0].previous_end) : null
  const nextStart = neighbors[0]?.next_start ? new Date(neighbors[0].next_start) : null
  if (previousEnd && clockInAt.getTime() < previousEnd.getTime()) return json({ message: 'Der neue Arbeitsbeginn überschneidet sich mit einem vorherigen Dienst.' }, 409)
  if (nextStart && clockOutAt.getTime() > nextStart.getTime()) return json({ message: 'Das neue Arbeitsende überschneidet sich mit einem folgenden Dienst.' }, 409)

  const [adjustmentRows, breakRows] = await Promise.all([
    sql.query(`SELECT pause_minutes FROM attendance_adjustments WHERE event_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`, [clockOutEventId]),
    sql.query(
      `SELECT action, client_occurred_at FROM attendance_events
        WHERE user_id = $1
          AND client_occurred_at >= $2::timestamptz
          AND client_occurred_at <= $3::timestamptz
          AND action IN ('break-start','break-end')
        ORDER BY client_occurred_at, server_occurred_at, id`,
      [clockInEvent.user_id, clockInEvent.client_occurred_at, clockOutEvent.client_occurred_at],
    ),
  ])
  const breakOutsideEditedRange = breakRows.some((row) => {
    const occurredAt = new Date(String(row.client_occurred_at))
    return !Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() < clockInAt.getTime() || occurredAt.getTime() > clockOutAt.getTime()
  })
  if (breakOutsideEditedRange) return json({ message: 'Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.' }, 409)

  const previousPause = adjustmentRows[0]?.pause_minutes === undefined || adjustmentRows[0]?.pause_minutes === null
    ? minutesFromBreakEvents(breakRows as Array<Record<string, unknown>>)
    : Number(adjustmentRows[0].pause_minutes)
  const before = {
    clockInAt: originalClockInAt.toISOString(),
    clockOutAt: originalClockOutAt.toISOString(),
    pauseMinutes: previousPause,
  }
  const after = { clockInAt: clockInAt.toISOString(), clockOutAt: clockOutAt.toISOString(), pauseMinutes }
  const now = new Date().toISOString()
  const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`

  await sql.query(
    `WITH updated_clock_in AS (
       UPDATE attendance_events
          SET client_occurred_at = $1::timestamptz, event_date = $2::date
        WHERE id = $3
        RETURNING id
     ),
     updated_clock_out AS (
       UPDATE attendance_events
          SET client_occurred_at = $4::timestamptz, event_date = $5::date
        WHERE id = $6
        RETURNING id
     ),
     created_adjustment AS (
       INSERT INTO attendance_adjustments
         (id, event_id, user_id, event_date, pause_minutes, reason, actor_id, actor_email, actor_role, occurred_at, expires_at)
       SELECT $7, $6, $8, $5::date, $9, $10, $11, $12, $13, $14::timestamptz, $14::timestamptz + interval '24 months'
       FROM updated_clock_in, updated_clock_out
       RETURNING id
     )
     INSERT INTO attendance_audit_log
       (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
     SELECT $15, $14::timestamptz, $11, $12, $13, 'admin-time-edit', 'attendance_session', $16, $10,
            $17::jsonb, $18::jsonb, $14::timestamptz + interval '24 months'
       FROM created_adjustment`,
    [
      clockInAt.toISOString(), eventDateInBerlin(clockInAt), clockInEventId,
      clockOutAt.toISOString(), eventDateInBerlin(clockOutAt), clockOutEventId,
      adjustmentId, clockInEvent.user_id, pauseMinutes, reason,
      ASSISTANT_ACTOR_ID, ASSISTANT_ACTOR_EMAIL, ASSISTANT_ACTOR_ROLE, now,
      auditId, `${clockInEventId}:${clockOutEventId}`, JSON.stringify(before), JSON.stringify(after),
    ],
  )

  return json({ action: 'update-attendance-session', saved: true, clockInEventId, clockOutEventId })
}

async function deleteAttendanceEvents(sql: Awaited<ReturnType<typeof connection>>, body: Record<string, unknown>) {
  const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(text).filter(Boolean) : []
  const reason = text(body.reason)
  if (!eventIds.length || eventIds.length > 25 || new Set(eventIds).size !== eventIds.length || reason.length < 2) {
    return json({ message: 'Zeiterfassungs-Löschauftrag ist ungültig.' }, 400)
  }

  const rows = await sql.query(
    `SELECT id, user_id, action, server_occurred_at, client_occurred_at, event_date,
            schedule_id, object_id, location_status, offline_captured
       FROM attendance_events
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [eventIds],
  )
  if (rows.length !== eventIds.length) return json({ message: 'Mindestens eine Buchung wurde nicht gefunden.' }, 404)

  const holds = await sql.query(
    `SELECT entity_id FROM attendance_legal_holds
      WHERE entity_type = 'attendance_event' AND held = true AND entity_id = ANY($1::text[])`,
    [eventIds],
  )
  if (holds.length) return json({ message: 'Mindestens eine Buchung steht unter Aufbewahrungsschutz.' }, 409)

  const now = new Date().toISOString()
  const deletedIds: string[] = []
  for (const row of rows) {
    const eventId = text(row.id)
    const before = {
      eventId,
      action: text(row.action),
      clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString(),
      serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(),
      scheduleId: row.schedule_id ? text(row.schedule_id) : null,
      objectId: row.object_id ? text(row.object_id) : null,
      locationStatus: text(row.location_status),
      offlineCaptured: row.offline_captured === true,
    }
    const deleted = await sql.query(
      `WITH target AS (
         SELECT id FROM attendance_events WHERE id = $1
       ), audited AS (
         INSERT INTO attendance_audit_log
           (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
         SELECT $2, $3::timestamptz, $4, $5, $6, 'assistant-event-delete', 'attendance_event', $1, $7, $8::jsonb, NULL, $3::timestamptz + interval '24 months'
           FROM target
         RETURNING id
       )
       DELETE FROM attendance_events e
        USING audited
        WHERE e.id = $1
       RETURNING e.id`,
      [eventId, `attendance-audit:${crypto.randomUUID()}`, now, ASSISTANT_ACTOR_ID, ASSISTANT_ACTOR_EMAIL, ASSISTANT_ACTOR_ROLE, reason, JSON.stringify(before)],
    )
    if (!deleted[0]) throw new Error(`Buchung ${eventId} konnte nicht atomar gelöscht werden.`)
    deletedIds.push(eventId)
  }

  return json({ action: 'delete-attendance-events', deletedCount: deletedIds.length, eventIds: deletedIds.sort() })
}

export default async function attendanceAssistant(request: Request, _context: Context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  if (!authorized(request)) return json({ message: 'Nicht autorisiert.' }, 401)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = text(body.action)

  let sql
  try {
    sql = await connection()
  } catch (error: any) {
    return json({ message: error.message }, error.status || 500)
  }

  try {
    if (action === 'list-attendance' || action === 'find-attendance-duplicates') {
      const from = text(body.from)
      const to = text(body.to)
      if (!validAttendanceRange(from, to)) return json({ message: 'Zeiterfassungs-Zeitraum ist ungültig.' }, 400)
      const data = await listAttendanceData(sql, from, to)
      if (action === 'list-attendance') return json({ action, ...data })
      const diagnostics = detectAttendanceDuplicates(
        data.events.map((event) => ({
          id: event.id,
          userId: event.userId,
          action: event.action,
          clientOccurredAt: event.clientOccurredAt,
          eventDate: event.eventDate,
          scheduleId: event.scheduleId,
        })) as AttendanceEventSnapshot[],
        data.employees.map((employee) => ({
          userId: employee.userId,
          fullName: employee.fullName,
          status: employee.status,
        })) as AttendanceEmployeeSnapshot[],
      )
      return json({ action, from, to, diagnostics, counts: data.counts })
    }
    if (action === 'update-attendance-session') return await updateAttendanceSession(sql, body)
    if (action === 'delete-attendance-events') return await deleteAttendanceEvents(sql, body)
    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    console.error('Habun attendance assistant', error)
    return json({ message: 'Der Zeiterfassungs-Auftrag konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-assistant' }
