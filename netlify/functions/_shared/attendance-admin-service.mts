export type AttendanceAdminActor = {
  userId: string
  email: string
  role: 'owner' | 'admin' | 'manager'
}

export type AttendanceSessionCreateInput = {
  userId: string
  clockInAt: string
  clockOutAt: string
  pauseMinutes: number
  scheduleId?: string | null
  objectId?: string | null
  reason?: string
}

export type AttendanceSessionUpdateInput = {
  clockInEventId: string
  clockOutEventId?: string | null
  clockInAt: string
  clockOutAt?: string | null
  pauseMinutes: number
  reason: string
}

export type AttendanceDeleteInput = {
  eventIds: string[]
  reason: string
}

export class AttendanceAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'ATTENDANCE_ADMIN_ERROR') {
    super(message)
    this.name = 'AttendanceAdminError'
    this.status = status
    this.code = code
  }
}

type AttendanceAdminOperations = {
  createSession(input: AttendanceSessionCreateInput, actor: AttendanceAdminActor): Promise<Record<string, unknown>>
  updateSession(input: AttendanceSessionUpdateInput, actor: AttendanceAdminActor): Promise<Record<string, unknown>>
  deleteEvents(input: AttendanceDeleteInput, actor: AttendanceAdminActor): Promise<Record<string, unknown>>
}

type SqlClient = { query(text: string, params?: unknown[]): Promise<any[]> }
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
  location_status?: string
  offline_captured?: boolean
  pause_minutes_adjustment: number | null
}
type Session = {
  clockIn: EventRow
  clockOut: EventRow | null
  breakEvents: EventRow[]
  activeBreak: EventRow | null
  pauseMinutes: number
}

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const RETENTION = "interval '24 months'"

function clean(value: unknown, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function fail(message: string, status = 400, code = 'ATTENDANCE_ADMIN_INVALID'): never {
  throw new AttendanceAdminError(message, status, code)
}

function requiredDate(value: unknown, label: string) {
  const raw = clean(value, 100)
  const date = new Date(raw)
  if (!raw || !Number.isFinite(date.getTime())) fail(`${label} ist kein gültiger Zeitpunkt.`, 400, 'INVALID_TIME')
  return date
}

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || clean(value, 100) === '') return null
  return requiredDate(value, label)
}

function pauseMinutes(value: unknown) {
  const pause = Number(value)
  if (!Number.isFinite(pause) || !Number.isInteger(pause) || pause < 0) {
    fail('Die Pause muss eine nichtnegative ganze Minute sein.', 400, 'INVALID_PAUSE')
  }
  return pause
}

function berlinDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

async function sqlConnection(): Promise<SqlClient> {
  const { databaseConnectionString } = await import('./database-connection.mts')
  const url = databaseConnectionString()
  if (!url) fail('Die Zeiterfassungsdatenbank ist noch nicht verbunden.', 503, 'DATABASE_UNAVAILABLE')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url) as unknown as SqlClient
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
      if (current.activeBreak) current.pauseMinutes += Math.max(0, Math.round((occurredAt(event) - occurredAt(current.activeBreak)) / 60000))
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

function ensureBreaksInside(session: Session, start: Date, end: Date | null) {
  const startMs = start.getTime()
  const endMs = end?.getTime() ?? Number.POSITIVE_INFINITY
  if (session.breakEvents.some((event) => {
    const time = occurredAt(event)
    return !Number.isFinite(time) || time < startMs || time > endMs
  })) fail('Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.', 409, 'BREAK_OUTSIDE_SESSION')
}

function syntheticBreakEnd(activeBreak: EventRow | null, requestedEnd: Date | null) {
  if (!activeBreak || !requestedEnd) return null
  const breakStart = occurredAt(activeBreak)
  const end = requestedEnd.getTime()
  if (!Number.isFinite(breakStart) || end <= breakStart) {
    fail('Das Arbeitsende muss nach dem Beginn der laufenden Pause liegen.', 409, 'INVALID_ACTIVE_BREAK_END')
  }
  const gap = end - breakStart
  return new Date(end - Math.min(1000, Math.max(1, Math.floor(gap / 2))))
}

async function assertNoLegalHold(sql: SqlClient, eventIds: string[]) {
  const ids = [...new Set(eventIds.map((id) => clean(id, 200)).filter(Boolean))]
  if (!ids.length) return
  const holds = await sql.query(
    `SELECT entity_id FROM attendance_legal_holds
      WHERE entity_type = 'attendance_event' AND held = true AND entity_id = ANY($1::text[])`,
    [ids],
  )
  if (holds.length) fail('Mindestens eine Buchung steht unter Aufbewahrungsschutz.', 409, 'LEGAL_HOLD')
}

async function defaultCreateSession(input: AttendanceSessionCreateInput, actor: AttendanceAdminActor) {
  const userId = clean(input.userId, 200)
  if (!userId) fail('Bitte einen Mitarbeiter auswählen.', 400, 'EMPLOYEE_REQUIRED')
  const clockInAt = requiredDate(input.clockInAt, 'Arbeitsbeginn')
  const clockOutAt = requiredDate(input.clockOutAt, 'Arbeitsende')
  const pause = pauseMinutes(input.pauseMinutes)
  if (clockOutAt.getTime() <= clockInAt.getTime()) fail('Das Arbeitsende muss nach dem Arbeitsbeginn liegen.', 400, 'END_BEFORE_START')
  const nowMs = Date.now()
  if (clockInAt.getTime() > nowMs + FUTURE_TOLERANCE_MS || clockOutAt.getTime() > nowMs + FUTURE_TOLERANCE_MS) {
    fail('Arbeitszeiten dürfen nicht in der Zukunft liegen.', 400, 'FUTURE_TIME')
  }
  const gross = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000)
  if (pause > gross) fail('Die Pause darf nicht länger als die Arbeitszeit sein.', 400, 'PAUSE_TOO_LONG')

  const sql = await sqlConnection()
  const serverNow = new Date().toISOString()
  const clockInEventId = `attendance:${crypto.randomUUID()}`
  const clockOutEventId = `attendance:${crypto.randomUUID()}`
  const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`
  const reason = clean(input.reason, 1000) || 'Manueller Stundenzettel-Eintrag'
  const scheduleId = clean(input.scheduleId, 200) || null
  const objectId = clean(input.objectId, 200) || null
  const after = JSON.stringify({ userId, clockInAt: clockInAt.toISOString(), clockOutAt: clockOutAt.toISOString(), pauseMinutes: pause, scheduleId, objectId })
  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ), latest_before AS MATERIALIZED (
       SELECT e.action FROM attendance_events e CROSS JOIN lock_user
        WHERE e.user_id = $1 AND e.client_occurred_at < $2::timestamptz
        ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC LIMIT 1
     ), conflict AS MATERIALIZED (
       SELECT EXISTS (
         SELECT 1 FROM attendance_events e CROSS JOIN lock_user
          WHERE e.user_id = $1 AND e.client_occurred_at >= $2::timestamptz AND e.client_occurred_at <= $3::timestamptz
       ) OR COALESCE((SELECT action FROM latest_before), 'clock-out') <> 'clock-out' AS overlap
     ), created_clock_in AS (
       INSERT INTO attendance_events
         (id,user_id,client_event_id,request_hash,action,server_occurred_at,client_occurred_at,event_date,schedule_id,object_id,location_status,offline_captured,expires_at)
       SELECT $4,$1,$5,$6,'clock-in',$7::timestamptz,$2::timestamptz,$8::date,$9,$10,'unavailable',false,$7::timestamptz + ${RETENTION}
       FROM conflict WHERE NOT overlap RETURNING id
     ), created_clock_out AS (
       INSERT INTO attendance_events
         (id,user_id,client_event_id,request_hash,action,server_occurred_at,client_occurred_at,event_date,schedule_id,object_id,location_status,offline_captured,expires_at)
       SELECT $11,$1,$12,$13,'clock-out',$7::timestamptz,$3::timestamptz,$14::date,$9,$10,'unavailable',false,$7::timestamptz + ${RETENTION}
       FROM created_clock_in RETURNING id
     ), created_adjustment AS (
       INSERT INTO attendance_adjustments
         (id,event_id,user_id,event_date,pause_minutes,reason,actor_id,actor_email,actor_role,occurred_at,expires_at)
       SELECT $15,$11,$1,$14::date,$16,$17,$18,$19,$20,$7::timestamptz,$7::timestamptz + ${RETENTION}
       FROM created_clock_out RETURNING id
     ), created_audit AS (
       INSERT INTO attendance_audit_log
         (id,occurred_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,reason,before_data,after_data,expires_at)
       SELECT $21,$7::timestamptz,$18,$19,$20,'admin-time-create','attendance_session',$4 || ':' || $11,$17,NULL,$22::jsonb,$7::timestamptz + ${RETENTION}
       FROM created_adjustment RETURNING id
     ) SELECT (SELECT overlap FROM conflict) AS overlap,
       (SELECT count(*)::int FROM created_clock_in) AS created_clock_in,
       (SELECT count(*)::int FROM created_clock_out) AS created_clock_out,
       (SELECT count(*)::int FROM created_audit) AS saved`,
    [userId, clockInAt.toISOString(), clockOutAt.toISOString(), clockInEventId,
      `management-clock-in:${crypto.randomUUID()}`, `manual-timesheet:${crypto.randomUUID()}`, serverNow,
      berlinDateKey(clockInAt), scheduleId, objectId, clockOutEventId,
      `management-clock-out:${crypto.randomUUID()}`, `manual-timesheet:${crypto.randomUUID()}`, berlinDateKey(clockOutAt),
      adjustmentId, pause, reason, actor.userId, actor.email, actor.role, auditId, after],
  )
  const result = rows[0]
  if (result?.overlap) fail('Die neue Arbeitszeit überschneidet sich mit einer vorhandenen Buchung.', 409, 'OVERLAP')
  if (!result?.saved || !result?.created_clock_in || !result?.created_clock_out) fail('Die Arbeitszeit konnte nicht vollständig gespeichert werden.', 409, 'INCOMPLETE_CREATE')
  return { saved: true, created: true, clockInEventId, clockOutEventId }
}

async function defaultUpdateSession(input: AttendanceSessionUpdateInput, actor: AttendanceAdminActor) {
  const clockInEventId = clean(input.clockInEventId, 200)
  const suppliedClockOutEventId = clean(input.clockOutEventId, 200) || null
  const reason = clean(input.reason, 1000)
  if (!clockInEventId || reason.length < 2) fail('Arbeitsbeginn und Begründung sind erforderlich.', 400, 'MISSING_EDIT_TARGET')
  const newStart = requiredDate(input.clockInAt, 'Arbeitsbeginn')
  const newEnd = optionalDate(input.clockOutAt, 'Arbeitsende')
  const pause = pauseMinutes(input.pauseMinutes)
  const nowMs = Date.now()
  if (newStart.getTime() > nowMs + FUTURE_TOLERANCE_MS) fail('Der Arbeitsbeginn darf nicht in der Zukunft liegen.', 400, 'FUTURE_START')
  if (newEnd && newEnd.getTime() > nowMs + FUTURE_TOLERANCE_MS) fail('Das Arbeitsende darf nicht in der Zukunft liegen.', 400, 'FUTURE_END')
  if (newEnd && newEnd.getTime() <= newStart.getTime()) fail('Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.', 400, 'END_BEFORE_START')
  if (newEnd) {
    const gross = Math.max(0, Math.round((newEnd.getTime() - newStart.getTime()) / 60000))
    if (pause > gross) fail('Die Pause darf nicht länger als die Arbeitszeit sein.', 400, 'PAUSE_TOO_LONG')
  }

  const sql = await sqlConnection()
  const clockInRows = await sql.query(
    `SELECT e.id,e.user_id,e.client_event_id,e.action,e.server_occurred_at,e.client_occurred_at,e.event_date,e.schedule_id,e.object_id,
            a.pause_minutes AS pause_minutes_adjustment
       FROM attendance_events e LEFT JOIN LATERAL (
         SELECT adjustment.pause_minutes FROM attendance_adjustments adjustment
          WHERE adjustment.event_id=e.id ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
       ) a ON true WHERE e.id=$1`, [clockInEventId],
  ) as EventRow[]
  const selected = clockInRows[0]
  if (!selected) fail('Der ausgewählte Arbeitszeiteintrag wurde nicht gefunden.', 404, 'NOT_FOUND')
  if (selected.action !== 'clock-in') fail('Der ausgewählte Beginn ist keine gültige Einstempelung.', 409, 'INVALID_CLOCK_IN')
  const events = await sql.query(
    `SELECT e.id,e.user_id,e.client_event_id,e.action,e.server_occurred_at,e.client_occurred_at,e.event_date,e.schedule_id,e.object_id,
            a.pause_minutes AS pause_minutes_adjustment
       FROM attendance_events e LEFT JOIN LATERAL (
         SELECT adjustment.pause_minutes FROM attendance_adjustments adjustment
          WHERE adjustment.event_id=e.id ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
       ) a ON true WHERE e.user_id=$1 ORDER BY e.client_occurred_at,e.server_occurred_at,e.id`, [selected.user_id],
  ) as EventRow[]
  const sessions = buildSessions(events)
  const index = sessions.findIndex((session) => session.clockIn.id === clockInEventId)
  const session = sessions[index]
  if (!session) fail('Der ausgewählte Dienst konnte nicht eindeutig zugeordnet werden.', 409, 'SESSION_AMBIGUOUS')
  const sessionEventIds = [session.clockIn.id, ...session.breakEvents.map((row) => row.id), ...(session.clockOut ? [session.clockOut.id] : [])]
  await assertNoLegalHold(sql, sessionEventIds)

  if (session.clockOut) {
    if (!suppliedClockOutEventId || suppliedClockOutEventId !== session.clockOut.id) fail('Der Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.', 409, 'STALE_SESSION')
    if (!newEnd) fail('Bei einem abgeschlossenen Dienst muss ein Arbeitsende eingetragen sein.', 400, 'END_REQUIRED')
    if (occurredAt(session.clockIn) > occurredAt(session.clockOut)) fail('Der gespeicherte Arbeitsbeginn liegt nach dem Arbeitsende.', 409, 'CORRUPT_SESSION')
  } else if (suppliedClockOutEventId) {
    fail('Der laufende Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.', 409, 'STALE_OPEN_SESSION')
  }
  const previous = sessions[index - 1]
  const next = sessions[index + 1]
  if (previous?.clockOut && newStart.getTime() < occurredAt(previous.clockOut)) fail('Der neue Arbeitsbeginn überschneidet sich mit einem vorherigen Dienst.', 409, 'PREVIOUS_OVERLAP')
  if (newEnd && next && newEnd.getTime() > occurredAt(next.clockIn)) fail('Das neue Arbeitsende überschneidet sich mit einem folgenden Dienst.', 409, 'NEXT_OVERLAP')
  if (!newEnd && next) fail('Ein laufender Dienst kann nicht über einen folgenden Dienst hinausreichen.', 409, 'OPEN_OVERLAP')
  ensureBreaksInside(session, newStart, newEnd)

  const serverNow = new Date().toISOString()
  const originalStart = new Date(session.clockIn.client_occurred_at)
  if (session.clockOut && newEnd) {
    const originalEnd = new Date(session.clockOut.client_occurred_at)
    const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
    const auditId = `attendance-audit:${crypto.randomUUID()}`
    const rows = await sql.query(
      `WITH lock_user AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext($1)) AS locked),
       state_ok AS MATERIALIZED (SELECT
         EXISTS(SELECT 1 FROM attendance_events e CROSS JOIN lock_user WHERE e.id=$2 AND e.user_id=$1 AND e.action='clock-in' AND e.client_occurred_at=$16::timestamptz)
         AND EXISTS(SELECT 1 FROM attendance_events e CROSS JOIN lock_user WHERE e.id=$3 AND e.user_id=$1 AND e.action='clock-out' AND e.client_occurred_at=$17::timestamptz) AS ok),
       updated_clock_in AS (UPDATE attendance_events e SET client_occurred_at=$4::timestamptz,event_date=$5::date FROM state_ok WHERE state_ok.ok AND e.id=$2 RETURNING e.id),
       updated_clock_out AS (UPDATE attendance_events e SET client_occurred_at=$6::timestamptz,event_date=$7::date FROM state_ok WHERE state_ok.ok AND e.id=$3 RETURNING e.id),
       created_adjustment AS (INSERT INTO attendance_adjustments(id,event_id,user_id,event_date,pause_minutes,reason,actor_id,actor_email,actor_role,occurred_at,expires_at)
         SELECT $8,$3,$1,$7::date,$9,$10,$11,$12,$13,$14::timestamptz,$14::timestamptz + ${RETENTION} FROM updated_clock_in,updated_clock_out RETURNING id),
       created_audit AS (INSERT INTO attendance_audit_log(id,occurred_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,reason,before_data,after_data,expires_at)
         SELECT $15,$14::timestamptz,$11,$12,$13,'admin-time-edit','attendance_session',$2 || ':' || $3,$10,$18::jsonb,$19::jsonb,$14::timestamptz + ${RETENTION} FROM created_adjustment RETURNING id)
       SELECT (SELECT count(*)::int FROM created_audit) AS saved`,
      [session.clockIn.user_id, session.clockIn.id, session.clockOut.id, newStart.toISOString(), berlinDateKey(newStart), newEnd.toISOString(), berlinDateKey(newEnd), adjustmentId, pause, reason, actor.userId, actor.email, actor.role, serverNow, auditId, originalStart.toISOString(), originalEnd.toISOString(),
       JSON.stringify({ clockInAt: originalStart.toISOString(), clockOutAt: originalEnd.toISOString(), pauseMinutes: session.pauseMinutes }),
       JSON.stringify({ clockInAt: newStart.toISOString(), clockOutAt: newEnd.toISOString(), pauseMinutes: pause })],
    )
    if (!rows[0]?.saved) fail('Der Dienst wurde zwischenzeitlich geändert. Bitte die Zeiten neu laden.', 409, 'STALE_SESSION')
    return { saved: true, clockInEventId: session.clockIn.id, clockOutEventId: session.clockOut.id, open: false }
  }

  const targetEvents = events.filter((event) => occurredAt(event) >= occurredAt(session.clockIn) && (!session.clockOut || occurredAt(event) <= occurredAt(session.clockOut)))
  const lastKnownEvent = targetEvents[targetEvents.length - 1] || session.clockIn
  if (!newEnd) {
    if (pause !== session.pauseMinutes) fail('Bei einem laufenden Dienst kann die Pause erst zusammen mit einem Arbeitsende korrigiert werden.', 409, 'OPEN_PAUSE_CHANGE')
    const auditId = `attendance-audit:${crypto.randomUUID()}`
    const rows = await sql.query(
      `WITH lock_user AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext($1)) AS locked),
       state_ok AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM attendance_events e CROSS JOIN lock_user WHERE e.id=$2 AND e.user_id=$1 AND e.action='clock-in' AND e.client_occurred_at=$9::timestamptz)
         AND COALESCE((SELECT e.id FROM attendance_events e CROSS JOIN lock_user WHERE e.user_id=$1 ORDER BY e.client_occurred_at DESC,e.server_occurred_at DESC,e.id DESC LIMIT 1),'')=$3 AS ok),
       updated_clock_in AS (UPDATE attendance_events e SET client_occurred_at=$4::timestamptz,event_date=$5::date FROM state_ok WHERE state_ok.ok AND e.id=$2 RETURNING e.id),
       created_audit AS (INSERT INTO attendance_audit_log(id,occurred_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,reason,before_data,after_data,expires_at)
         SELECT $6,$7::timestamptz,$10,$11,$12,'admin-time-edit','attendance_session',$2 || ':open',$8,$13::jsonb,$14::jsonb,$7::timestamptz + ${RETENTION} FROM updated_clock_in RETURNING id)
       SELECT (SELECT count(*)::int FROM created_audit) AS saved`,
      [session.clockIn.user_id, session.clockIn.id, lastKnownEvent.id, newStart.toISOString(), berlinDateKey(newStart), auditId, serverNow, reason, originalStart.toISOString(), actor.userId, actor.email, actor.role,
       JSON.stringify({ clockInAt: originalStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes }),
       JSON.stringify({ clockInAt: newStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes })],
    )
    if (!rows[0]?.saved) fail('Der laufende Dienst wurde zwischenzeitlich verändert. Bitte die Zeiten neu laden.', 409, 'STALE_OPEN_SESSION')
    return { saved: true, clockInEventId: session.clockIn.id, clockOutEventId: null, open: true }
  }

  const breakEndAt = syntheticBreakEnd(session.activeBreak, newEnd)
  const clockOutId = `attendance:${crypto.randomUUID()}`
  const adjustmentId = `attendance-adjustment:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`
  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext($1)) AS locked),
     state_ok AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM attendance_events e CROSS JOIN lock_user WHERE e.id=$2 AND e.user_id=$1 AND e.action='clock-in' AND e.client_occurred_at=$20::timestamptz)
       AND COALESCE((SELECT e.id FROM attendance_events e CROSS JOIN lock_user WHERE e.user_id=$1 ORDER BY e.client_occurred_at DESC,e.server_occurred_at DESC,e.id DESC LIMIT 1),'')=$3 AS ok),
     updated_clock_in AS (UPDATE attendance_events e SET client_occurred_at=$4::timestamptz,event_date=$5::date FROM state_ok WHERE state_ok.ok AND e.id=$2 RETURNING e.id),
     created_break_end AS (INSERT INTO attendance_events(id,user_id,client_event_id,request_hash,action,server_occurred_at,client_occurred_at,event_date,schedule_id,object_id,location_status,offline_captured,expires_at)
       SELECT $6,$1,$7,$8,'break-end',$9::timestamptz,$10::timestamptz,$11::date,$12,$13,'unavailable',false,$9::timestamptz + ${RETENTION} FROM updated_clock_in WHERE $14::boolean RETURNING id),
     created_clock_out AS (INSERT INTO attendance_events(id,user_id,client_event_id,request_hash,action,server_occurred_at,client_occurred_at,event_date,schedule_id,object_id,location_status,offline_captured,expires_at)
       SELECT $15,$1,$16,$17,'clock-out',$9::timestamptz,$18::timestamptz,$19::date,$12,$13,'unavailable',false,$9::timestamptz + ${RETENTION} FROM updated_clock_in RETURNING id),
     created_adjustment AS (INSERT INTO attendance_adjustments(id,event_id,user_id,event_date,pause_minutes,reason,actor_id,actor_email,actor_role,occurred_at,expires_at)
       SELECT $21,$15,$1,$19::date,$22,$23,$24,$25,$26,$9::timestamptz,$9::timestamptz + ${RETENTION} FROM created_clock_out RETURNING id),
     created_audit AS (INSERT INTO attendance_audit_log(id,occurred_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,reason,before_data,after_data,expires_at)
       SELECT $27,$9::timestamptz,$24,$25,$26,'admin-time-edit','attendance_session',$2 || ':' || $15,$23,$28::jsonb,$29::jsonb,$9::timestamptz + ${RETENTION} FROM created_adjustment RETURNING id)
     SELECT (SELECT count(*)::int FROM created_clock_out) AS created_clock_out,(SELECT count(*)::int FROM created_audit) AS saved`,
    [session.clockIn.user_id, session.clockIn.id, lastKnownEvent.id, newStart.toISOString(), berlinDateKey(newStart), `attendance:${crypto.randomUUID()}`, `management-break-end:${crypto.randomUUID()}`, `management-time-edit:${crypto.randomUUID()}`, serverNow,
     breakEndAt?.toISOString() || newEnd.toISOString(), berlinDateKey(breakEndAt || newEnd), session.clockIn.schedule_id, session.clockIn.object_id, Boolean(breakEndAt), clockOutId, `management-clock-out:${crypto.randomUUID()}`, `management-time-edit:${crypto.randomUUID()}`, newEnd.toISOString(), berlinDateKey(newEnd), originalStart.toISOString(), adjustmentId, pause, reason, actor.userId, actor.email, actor.role, auditId,
     JSON.stringify({ clockInAt: originalStart.toISOString(), clockOutAt: null, pauseMinutes: session.pauseMinutes }),
     JSON.stringify({ clockInAt: newStart.toISOString(), clockOutAt: newEnd.toISOString(), pauseMinutes: pause })],
  )
  if (!rows[0]?.saved || !rows[0]?.created_clock_out) fail('Der laufende Dienst wurde zwischenzeitlich verändert. Bitte die Zeiten neu laden.', 409, 'STALE_OPEN_SESSION')
  return { saved: true, clockInEventId: session.clockIn.id, clockOutEventId: clockOutId, open: false }
}

async function defaultDeleteEvents(input: AttendanceDeleteInput, actor: AttendanceAdminActor) {
  const eventIds = Array.isArray(input.eventIds) ? input.eventIds.map((id) => clean(id, 200)).filter(Boolean) : []
  const reason = clean(input.reason, 1000)
  if (!eventIds.length || eventIds.length > 25 || new Set(eventIds).size !== eventIds.length || reason.length < 2) fail('Zeiterfassungs-Löschauftrag ist ungültig.', 400, 'INVALID_DELETE')
  const sql = await sqlConnection()
  const rows = await sql.query(
    `SELECT id,user_id,action,server_occurred_at,client_occurred_at,event_date,schedule_id,object_id,location_status,offline_captured
       FROM attendance_events WHERE id = ANY($1::text[]) ORDER BY id`, [eventIds],
  )
  if (rows.length !== eventIds.length) fail('Mindestens eine Buchung wurde nicht gefunden.', 404, 'NOT_FOUND')
  await assertNoLegalHold(sql, eventIds)
  const now = new Date().toISOString()
  const deletedIds: string[] = []
  for (const row of rows) {
    const eventId = clean(row.id, 200)
    const before = { eventId, action: clean(row.action), clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString(), serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(), scheduleId: row.schedule_id ? clean(row.schedule_id) : null, objectId: row.object_id ? clean(row.object_id) : null, locationStatus: clean(row.location_status), offlineCaptured: row.offline_captured === true }
    const deleted = await sql.query(
      `WITH target AS (SELECT id FROM attendance_events WHERE id=$1), audited AS (
         INSERT INTO attendance_audit_log(id,occurred_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,reason,before_data,after_data,expires_at)
         SELECT $2,$3::timestamptz,$4,$5,$6,'assistant-event-delete','attendance_event',$1,$7,$8::jsonb,NULL,$3::timestamptz + ${RETENTION} FROM target RETURNING id)
       DELETE FROM attendance_events e USING audited WHERE e.id=$1 RETURNING e.id`,
      [eventId, `attendance-audit:${crypto.randomUUID()}`, now, actor.userId, actor.email, actor.role, reason, JSON.stringify(before)],
    )
    if (!deleted[0]) fail('Die Buchung konnte nicht atomar gelöscht werden.', 409, 'DELETE_CONFLICT')
    deletedIds.push(eventId)
  }
  return { deletedIds: deletedIds.sort(), deletedCount: deletedIds.length }
}

const defaultOperations: AttendanceAdminOperations = {
  createSession: defaultCreateSession,
  updateSession: defaultUpdateSession,
  deleteEvents: defaultDeleteEvents,
}

export function createAttendanceAdminService(overrides: Partial<AttendanceAdminOperations> = {}) {
  const operations = { ...defaultOperations, ...overrides }
  return {
    createSession: (input: AttendanceSessionCreateInput, actor: AttendanceAdminActor) => operations.createSession(input, actor),
    updateSession: (input: AttendanceSessionUpdateInput, actor: AttendanceAdminActor) => operations.updateSession(input, actor),
    deleteEvents: (input: AttendanceDeleteInput, actor: AttendanceAdminActor) => operations.deleteEvents(input, actor),
  }
}

export function attendanceAdminService() {
  return createAttendanceAdminService()
}
