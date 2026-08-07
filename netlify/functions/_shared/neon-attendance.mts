const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCATION_STATUSES = new Set(['inside', 'outside', 'unavailable'])

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timestamp(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value)
}

function dateOnly(value: unknown) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function textOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

export function mapAttendanceObjectRow(row: Record<string, unknown> | null) {
  if (!row) return null
  return {
    id: String(row.id),
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    accuracyMeters: numberOrNull(row.accuracy_meters),
    radiusMeters: numberOrNull(row.radius_meters) ?? 500,
  }
}

export function mapAttendanceEventRow(row: Record<string, unknown>) {
  const latitude = numberOrNull(row.latitude)
  const longitude = numberOrNull(row.longitude)
  const accuracyMeters = numberOrNull(row.accuracy_meters)
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clientEventId: String(row.client_event_id),
    action: String(row.action),
    serverOccurredAt: timestamp(row.server_occurred_at),
    clientOccurredAt: timestamp(row.client_occurred_at),
    eventDate: dateOnly(row.event_date),
    scheduleId: textOrNull(row.schedule_id),
    objectId: textOrNull(row.object_id),
    locationStatus: String(row.location_status),
    offlineCaptured: Boolean(row.offline_captured),
    pauseMinutesAdjustment: numberOrNull(row.pause_minutes_adjustment),
    location: latitude !== null && longitude !== null && accuracyMeters !== null
      ? { latitude, longitude, accuracyMeters, distanceMeters: numberOrNull(row.distance_meters) }
      : null,
  }
}

export function normalizeAttendanceFilters(filters: Record<string, unknown> = {}) {
  const result = {
    from: textOrNull(filters.from),
    to: textOrNull(filters.to),
    date: textOrNull(filters.date),
    userId: textOrNull(filters.userId),
    objectId: textOrNull(filters.objectId),
    status: textOrNull(filters.status),
  }
  for (const key of ['from', 'to', 'date'] as const) {
    if (result[key] && !ISO_DATE.test(result[key])) throw new TypeError(`${key} muss ein ISO-Datum im Format JJJJ-MM-TT sein.`)
  }
  if (result.status && !LOCATION_STATUSES.has(result.status)) throw new TypeError('Der Standortstatus ist ungültig.')
  return result
}

export function repositorySafetyMarkers() {
  return { advisoryLock: true, idempotency: true, auditTrail: true, locationExpiryMonths: 6, attendanceExpiryMonths: 24, pauseEvents: true }
}

const EVENT_SELECT = `
  SELECT e.id, e.user_id, e.client_event_id, e.action,
         e.server_occurred_at, e.client_occurred_at, e.event_date,
         e.schedule_id, e.object_id, e.location_status, e.offline_captured,
         a.pause_minutes AS pause_minutes_adjustment,
         l.latitude, l.longitude, l.accuracy_meters, l.distance_meters
  FROM attendance_events e
  LEFT JOIN attendance_locations l ON l.event_id = e.id
  LEFT JOIN LATERAL (
    SELECT adjustment.pause_minutes
      FROM attendance_adjustments adjustment
     WHERE adjustment.event_id = e.id
     ORDER BY adjustment.occurred_at DESC, adjustment.id DESC
     LIMIT 1
  ) a ON true
`

export async function createAttendanceRepository(connectionString: string) {
  const databaseUrl = String(connectionString || '').trim()
  if (!databaseUrl) throw new Error('ATTENDANCE_DATABASE_URL ist nicht konfiguriert.')
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(databaseUrl)

  async function findIdempotency(userId: string, clientEventId: string) {
    const rows = await sql.query(`SELECT request_hash, response_data FROM attendance_idempotency WHERE user_id = $1 AND client_event_id = $2`, [userId, clientEventId])
    const row = rows[0]
    return row ? { requestHash: row.request_hash, response: row.response_data } : null
  }

  async function listEvents(userId: string) {
    const rows = await sql.query(`${EVENT_SELECT} WHERE e.user_id = $1 ORDER BY e.client_occurred_at, e.server_occurred_at, e.id`, [userId])
    return rows.map(mapAttendanceEventRow)
  }

  async function findObject(objectId: string) {
    const rows = await sql.query(`SELECT id, latitude, longitude, accuracy_meters, radius_meters FROM attendance_objects WHERE id = $1`, [objectId])
    return mapAttendanceObjectRow(rows[0] || null)
  }

  async function commitClockEvent(record: Record<string, any>) {
    const responseData = { event: record.event, location: record.location, replayed: false }
    const auditId = `attendance-audit:${crypto.randomUUID()}`
    const params = [
      record.userId,
      record.clientEventId,
      record.requestHash,
      record.event.action,
      record.event.serverOccurredAt,
      record.event.clientOccurredAt,
      record.event.eventDate,
      record.event.scheduleId,
      record.event.objectId,
      record.event.locationStatus,
      record.event.offlineCaptured,
      record.event.id,
      record.actorEmail,
      record.actorRole,
      Boolean(record.location),
      record.location?.latitude ?? null,
      record.location?.longitude ?? null,
      record.location?.accuracyMeters ?? null,
      record.location?.distanceMeters ?? null,
      JSON.stringify(responseData),
      auditId,
    ]

    const rows = await sql.query(
      `WITH lock_user AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
       ),
       existing AS MATERIALIZED (
         SELECT i.request_hash, i.response_data
         FROM attendance_idempotency i CROSS JOIN lock_user
         WHERE i.user_id = $1 AND i.client_event_id = $2
       ),
       latest AS MATERIALIZED (
         SELECT e.action, e.client_occurred_at
         FROM attendance_events e CROSS JOIN lock_user
         WHERE e.user_id = $1
         ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
         LIMIT 1
       ),
       transition AS MATERIALIZED (
         SELECT
           CASE
             WHEN EXISTS (SELECT 1 FROM latest WHERE client_occurred_at > $6::timestamptz) THEN false
             WHEN $4 = 'clock-in' AND COALESCE((SELECT action FROM latest), 'clock-out') = 'clock-out' THEN true
             WHEN $4 = 'break-start' AND COALESCE((SELECT action FROM latest), '') IN ('clock-in', 'break-end') THEN true
             WHEN $4 = 'break-end' AND (SELECT action FROM latest) = 'break-start' THEN true
             WHEN $4 = 'clock-out' AND COALESCE((SELECT action FROM latest), '') IN ('clock-in', 'break-end') THEN true
             ELSE false
           END AS ok,
           CASE
             WHEN EXISTS (SELECT 1 FROM latest WHERE client_occurred_at > $6::timestamptz) THEN 'OUT_OF_ORDER_EVENT'
             WHEN $4 = 'clock-in' THEN 'CLOCK_IN_ALREADY_OPEN'
             WHEN $4 = 'break-start' THEN 'BREAK_START_WITHOUT_WORK'
             WHEN $4 = 'break-end' THEN 'BREAK_END_WITHOUT_BREAK'
             WHEN $4 = 'clock-out' AND (SELECT action FROM latest) = 'break-start' THEN 'BREAK_MUST_END_FIRST'
             ELSE 'CLOCK_OUT_WITHOUT_CLOCK_IN'
           END AS code
       ),
       claimed AS (
         INSERT INTO attendance_idempotency
           (user_id, client_event_id, request_hash, response_data, created_at, expires_at)
         SELECT $1, $2, $3, $20::jsonb, $5::timestamptz, $5::timestamptz + interval '24 months'
         FROM transition
         WHERE transition.ok AND NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT DO NOTHING
         RETURNING user_id
       ),
       created_event AS (
         INSERT INTO attendance_events
           (id, user_id, client_event_id, request_hash, action, server_occurred_at,
            client_occurred_at, event_date, schedule_id, object_id, location_status,
            offline_captured, expires_at)
         SELECT $12, $1, $2, $3, $4, $5::timestamptz,
                $6::timestamptz, $7::date, $8, $9, $10, $11,
                $5::timestamptz + interval '24 months'
         FROM claimed
         RETURNING id
       ),
       created_location AS (
         INSERT INTO attendance_locations
           (event_id, user_id, object_id, captured_at, latitude, longitude,
            accuracy_meters, distance_meters, expires_at)
         SELECT $12, $1, $9, $6::timestamptz, $16, $17, $18, $19,
                $5::timestamptz + interval '6 months'
         FROM created_event
         WHERE $15::boolean
         RETURNING event_id
       ),
       created_audit AS (
         INSERT INTO attendance_audit_log
           (id, occurred_at, actor_id, actor_email, actor_role, action,
            entity_type, entity_id, reason, before_data, after_data, expires_at)
         SELECT $21, $5::timestamptz, $1, $13, $14, $4,
                'attendance_event', $12, NULL, NULL,
                jsonb_build_object(
                  'action', $4,
                  'locationStatus', $10,
                  'offlineCaptured', $11,
                  'eventId', $12,
                  'clientOccurredAt', $6,
                  'serverOccurredAt', $5,
                  'scheduleId', $8,
                  'objectId', $9
                ),
                $5::timestamptz + interval '24 months'
         FROM created_event
         RETURNING id
       )
       SELECT
         CASE
           WHEN EXISTS (SELECT 1 FROM existing WHERE request_hash <> $3) THEN 'conflict'
           WHEN EXISTS (SELECT 1 FROM existing) THEN 'replay'
           WHEN NOT (SELECT ok FROM transition) THEN 'invalid-transition'
           WHEN EXISTS (SELECT 1 FROM created_event) THEN 'created'
           ELSE 'conflict'
         END AS kind,
         COALESCE((SELECT response_data FROM existing), $20::jsonb) AS response_data,
         (SELECT code FROM transition) AS transition_code`,
      params,
    )

    const result = rows[0] || { kind: 'conflict' }
    if (result.kind === 'conflict') {
      const afterRace = await findIdempotency(record.userId, record.clientEventId)
      if (afterRace && afterRace.requestHash === record.requestHash) return { kind: 'replay', response: { ...afterRace.response, replayed: true } }
    }
    if (result.kind === 'replay') return { kind: 'replay', response: { ...(result.response_data || {}), replayed: true } }
    if (result.kind === 'invalid-transition') return { kind: 'invalid-transition', code: result.transition_code }
    return { kind: result.kind, response: result.response_data }
  }

  async function listHistory(rawFilters: Record<string, unknown> = {}) {
    const filters = normalizeAttendanceFilters(rawFilters)
    const rows = await sql.query(
      `${EVENT_SELECT}
       WHERE ($1::text IS NULL OR e.user_id = $1)
         AND ($2::date IS NULL OR e.event_date >= $2::date)
         AND ($3::date IS NULL OR e.event_date <= $3::date)
       ORDER BY e.client_occurred_at, e.server_occurred_at, e.id`,
      [filters.userId, filters.from, filters.to],
    )
    return rows.map(mapAttendanceEventRow)
  }

  async function listLive(rawFilters: Record<string, unknown> = {}) {
    const filters = normalizeAttendanceFilters(rawFilters)
    const rows = await sql.query(
      `${EVENT_SELECT}
       WHERE e.event_date = COALESCE($1::date, (now() AT TIME ZONE 'Europe/Berlin')::date)
         AND ($2::text IS NULL OR e.object_id = $2)
         AND ($3::text IS NULL OR e.user_id = $3)
         AND ($4::text IS NULL OR e.location_status = $4)
       ORDER BY e.client_occurred_at, e.server_occurred_at, e.id`,
      [filters.date, filters.objectId, filters.userId, filters.status],
    )
    return rows.map(mapAttendanceEventRow)
  }

  return { findIdempotency, listEvents, findObject, commitClockEvent, listHistory, listLive }
}
