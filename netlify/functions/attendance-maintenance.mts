import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { eventDateInBerlin } from './_shared/daily-attendance-service.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const ADMINISTRATION = new Set<Role>(['owner', 'admin'])

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

export function cleanRequestedData(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const clean: Record<string, unknown> = {}
  for (const key of ['clockInAt', 'clockOutAt'] as const) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue
    const date = new Date(String(source[key]))
    if (!Number.isFinite(date.getTime())) throw new TypeError(`${key} ist kein gültiger Zeitpunkt.`)
    clean[key] = date.toISOString()
  }
  if (source.pauseMinutes !== undefined && source.pauseMinutes !== null && source.pauseMinutes !== '') {
    const pause = Number(source.pauseMinutes)
    if (!Number.isFinite(pause) || pause < 0 || !Number.isInteger(pause)) throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
    clean.pauseMinutes = pause
  }
  if (source.note !== undefined && source.note !== null) {
    const note = String(source.note).trim()
    if (note) clean.note = note.slice(0, 1000)
  }
  return clean
}

async function connection() {
  const url = databaseConnectionString()
  if (!url) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
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

async function listCorrections(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>) {
  const rows = await sql.query(
    `SELECT c.id, c.event_id, c.requested_by, c.reason, c.before_data, c.after_data,
            c.occurred_at, c.expires_at,
            d.decision, d.reason AS decision_reason, d.after_data AS decision_after_data,
            d.occurred_at AS decided_at, d.actor_role AS decided_by_role
       FROM attendance_corrections c
       LEFT JOIN LATERAL (
         SELECT * FROM attendance_correction_decisions d
          WHERE d.correction_id = c.id
          ORDER BY d.occurred_at DESC, d.id DESC LIMIT 1
       ) d ON true
      WHERE ($1::boolean OR c.requested_by = $2)
      ORDER BY c.occurred_at DESC`,
    [MANAGEMENT.has(current.role), current.userId],
  )
  return rows
}

async function requestCorrection(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const eventId = String(body.eventId || '').trim()
  const reason = String(body.reason || '').trim()
  if (!eventId || reason.length < 3) return json({ message: 'Buchung und nachvollziehbarer Grund sind erforderlich.' }, 400)
  const events = await sql.query(`SELECT * FROM attendance_events WHERE id = $1 AND user_id = $2`, [eventId, current.userId])
  if (!events[0]) return json({ message: 'Die Buchung wurde nicht gefunden oder gehört nicht zu diesem Konto.' }, 404)
  const afterData = cleanRequestedData(body.requestedData)
  if (!Object.keys(afterData).length) return json({ message: 'Mindestens eine gewünschte Korrektur ist erforderlich.' }, 400)
  const id = `attendance-correction:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const before = {
    clientOccurredAt: new Date(events[0].client_occurred_at).toISOString(),
    scheduleId: events[0].schedule_id,
    objectId: events[0].object_id,
    locationStatus: events[0].location_status,
  }
  await sql.query(
    `INSERT INTO attendance_corrections
       (id, event_id, requested_by, actor_id, actor_email, actor_role, reason,
        before_data, after_data, occurred_at, expires_at)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::timestamptz,$9::timestamptz + interval '24 months')`,
    [id, eventId, current.userId, current.email, current.role, reason, JSON.stringify(before), JSON.stringify(afterData), now],
  )
  await sql.query(
    `INSERT INTO attendance_audit_log
       (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
     VALUES ($1,$2::timestamptz,$3,$4,$5,'correction-request','attendance_correction',$6,$7,$8::jsonb,$9::jsonb,$2::timestamptz + interval '24 months')`,
    [`attendance-audit:${crypto.randomUUID()}`, now, current.userId, current.email, current.role, id, reason, JSON.stringify(before), JSON.stringify(afterData)],
  )
  return json({ id, status: 'requested' }, 201)
}

async function decideCorrection(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const correctionId = String(body.correctionId || '').trim()
  const decision = String(body.decision || '').trim()
  const reason = String(body.reason || '').trim()
  if (!correctionId || !['approved', 'rejected', 'clarification'].includes(decision) || reason.length < 2) {
    return json({ message: 'Korrektur, Entscheidung und Begründung sind erforderlich.' }, 400)
  }
  const corrections = await sql.query(`SELECT * FROM attendance_corrections WHERE id = $1`, [correctionId])
  const correction = corrections[0]
  if (!correction) return json({ message: 'Korrekturantrag nicht gefunden.' }, 404)
  const latest = await sql.query(
    `SELECT decision FROM attendance_correction_decisions WHERE correction_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [correctionId],
  )
  if (['approved', 'rejected'].includes(String(latest[0]?.decision || ''))) {
    return json({ message: 'Dieser Korrekturantrag wurde bereits endgültig entschieden.' }, 409)
  }
  const requested = cleanRequestedData(correction.after_data)
  const afterData = decision === 'approved'
    ? cleanRequestedData(body.afterData && typeof body.afterData === 'object' ? body.afterData : requested)
    : correction.before_data
  const requestData = {
    id: correction.id,
    eventId: correction.event_id,
    requestedBy: correction.requested_by,
    reason: correction.reason,
    occurredAt: new Date(correction.occurred_at).toISOString(),
  }
  const id = `attendance-decision:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await sql.query(
    `INSERT INTO attendance_correction_decisions
       (id, correction_id, decision, actor_id, actor_email, actor_role, reason,
        request_data, before_data, after_data, occurred_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::timestamptz,$11::timestamptz + interval '24 months')`,
    [id, correctionId, decision, current.userId, current.email, current.role, reason,
      JSON.stringify(requestData), JSON.stringify(correction.before_data), JSON.stringify(afterData), now],
  )
  await sql.query(
    `INSERT INTO attendance_audit_log
       (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
     VALUES ($1,$2::timestamptz,$3,$4,$5,$6,'attendance_correction',$7,$8,$9::jsonb,$10::jsonb,$2::timestamptz + interval '24 months')`,
    [`attendance-audit:${crypto.randomUUID()}`, now, current.userId, current.email, current.role, `correction-${decision}`, correctionId, reason,
      JSON.stringify(correction.before_data), JSON.stringify(afterData)],
  )
  return json({ id, correctionId, decision }, 201)
}

async function adminTimeEdit(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!ADMINISTRATION.has(current.role)) return json({ message: 'Nur Chef/Hauptadmin oder Admin dürfen Arbeitszeiten direkt bearbeiten.' }, 403)

  const clockInEventId = String(body.clockInEventId || '').trim()
  const clockOutEventId = String(body.clockOutEventId || '').trim()
  const reason = String(body.reason || '').trim()
  if (!clockInEventId || !clockOutEventId || reason.length < 2) return json({ message: 'Beginn, Ende und Begründung sind erforderlich.' }, 400)

  const requested = cleanRequestedData(body)
  if (!requested.clockInAt || !requested.clockOutAt || requested.pauseMinutes === undefined) {
    return json({ message: 'Beginn, Ende und Pause müssen vollständig angegeben werden.' }, 400)
  }
  const clockInAt = new Date(String(requested.clockInAt))
  const clockOutAt = new Date(String(requested.clockOutAt))
  const pauseMinutes = Number(requested.pauseMinutes)
  const grossMinutes = Math.max(0, Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000))
  if (clockOutAt.getTime() < clockInAt.getTime()) return json({ message: 'Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.' }, 400)
  if (pauseMinutes > grossMinutes) return json({ message: 'Die Pause darf nicht länger als die Arbeitszeit sein.' }, 400)

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
  const originalClockInAt = new Date(clockInEvent.client_occurred_at)
  const originalClockOutAt = new Date(clockOutEvent.client_occurred_at)
  if (originalClockInAt.getTime() > originalClockOutAt.getTime()) {
    return json({ message: 'Der gespeicherte Arbeitsbeginn liegt nach dem Arbeitsende.' }, 409)
  }

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
  if (breakOutsideEditedRange) {
    return json({ message: 'Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.' }, 409)
  }
  const previousPause = adjustmentRows[0]?.pause_minutes === undefined || adjustmentRows[0]?.pause_minutes === null
    ? minutesFromBreakEvents(breakRows)
    : Number(adjustmentRows[0].pause_minutes)
  const before = {
    clockInAt: new Date(clockInEvent.client_occurred_at).toISOString(),
    clockOutAt: new Date(clockOutEvent.client_occurred_at).toISOString(),
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
      current.userId, current.email, current.role, now,
      auditId, `${clockInEventId}:${clockOutEventId}`, JSON.stringify(before), JSON.stringify(after),
    ],
  )

  return json({ saved: true, clockInEventId, clockOutEventId })
}

async function retention(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, apply: boolean) {
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Nur die Administration darf Aufbewahrungsdaten bereinigen.' }, 403)
  const locationCount = await sql.query(
    `SELECT count(*)::int AS count FROM attendance_locations l
      WHERE l.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
  )
  const eventCount = await sql.query(
    `SELECT count(*)::int AS count FROM attendance_events e
      WHERE e.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
  )
  if (apply) {
    await sql.query(
      `DELETE FROM attendance_locations l WHERE l.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
    )
    await sql.query(
      `DELETE FROM attendance_events e WHERE e.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
    )
  }
  return json({ dryRun: !apply, expiredLocations: locationCount[0]?.count || 0, expiredEvents: eventCount[0]?.count || 0 })
}

export default async function maintenance(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  let sql
  try { sql = await connection() } catch (error: any) { return json({ message: error.message }, error.status || 500) }
  const url = new URL(request.url)
  if (request.method === 'GET') {
    if ((url.searchParams.get('resource') || 'corrections') === 'corrections') return json({ corrections: await listCorrections(sql, current) })
    return json({ message: 'Unbekannter Bereich.' }, 400)
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || '')
  try {
    if (action === 'request-correction') return await requestCorrection(sql, current, body)
    if (action === 'decide-correction') return await decideCorrection(sql, current, body)
    if (action === 'admin-time-edit') return await adminTimeEdit(sql, current, body)
    if (action === 'retention-dry-run') return await retention(sql, current, false)
    if (action === 'retention-apply') return await retention(sql, current, true)
    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message }, 400)
    console.error('Habun attendance maintenance', error)
    return json({ message: 'Die Korrektur-, Zeit- oder Aufbewahrungsaktion ist fehlgeschlagen.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-maintenance' }
