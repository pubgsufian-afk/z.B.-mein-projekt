import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { eventDateInBerlin } from './_shared/daily-attendance-service.mts'
import { currentPortalActor } from './_shared/portal-role.mts'

const DIRECT_TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const AUTOMATIC_REASON = 'Manuelle Korrektur durch Verwaltung'

type EventRow = {
  id: string
  user_id: string
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  server_occurred_at: string | Date
  client_occurred_at: string | Date
  pause_minutes_adjustment: number | null
}

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

function parsePause(value: unknown) {
  const pause = Number(value)
  if (!Number.isFinite(pause) || !Number.isInteger(pause) || pause < 0) {
    throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
  }
  return pause
}

function effectiveOpenPause(events: EventRow[]) {
  const clockIn = events.find((event) => event.action === 'clock-in')
  if (clockIn?.pause_minutes_adjustment !== null && clockIn?.pause_minutes_adjustment !== undefined) {
    return Math.max(0, Number(clockIn.pause_minutes_adjustment) || 0)
  }

  let breakStart: number | null = null
  let minutes = 0
  for (const event of events) {
    const occurredAt = new Date(event.client_occurred_at).getTime()
    if (!Number.isFinite(occurredAt)) continue
    if (event.action === 'break-start') breakStart = occurredAt
    if (event.action === 'break-end' && breakStart !== null) {
      minutes += Math.max(0, Math.round((occurredAt - breakStart) / 60000))
      breakStart = null
    }
  }
  return minutes
}

async function proxyExistingEditor(request: Request, body: Record<string, unknown>) {
  const target = new URL('/api/attendance-time-edit', request.url)
  const headers = new Headers(request.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  return fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, reason: AUTOMATIC_REASON }),
  })
}

async function editOpenSessionWithoutEnd(
  current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>,
  clockInEventId: string,
  newStart: Date,
  pauseMinutes: number,
) {
  let sql: Awaited<ReturnType<typeof connection>>
  try { sql = await connection() } catch (error: any) { return json({ message: error.message }, error.status || 500) }

  const selectedRows = await sql.query(
    `SELECT e.id, e.user_id, e.action, e.server_occurred_at, e.client_occurred_at,
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
  const selected = selectedRows[0]
  if (!selected || selected.action !== 'clock-in') return json({ message: 'Der ausgewählte Arbeitsbeginn wurde nicht gefunden.' }, 404)

  const sessionEvents = await sql.query(
    `SELECT e.id, e.user_id, e.action, e.server_occurred_at, e.client_occurred_at,
            a.pause_minutes AS pause_minutes_adjustment
       FROM attendance_events e
       LEFT JOIN LATERAL (
         SELECT adjustment.pause_minutes
           FROM attendance_adjustments adjustment
          WHERE adjustment.event_id = e.id
          ORDER BY adjustment.occurred_at DESC, adjustment.id DESC LIMIT 1
       ) a ON true
      WHERE e.user_id = $1
        AND e.client_occurred_at >= $2::timestamptz
      ORDER BY e.client_occurred_at, e.server_occurred_at, e.id`,
    [selected.user_id, new Date(selected.client_occurred_at).toISOString()],
  ) as EventRow[]

  const firstClockIn = sessionEvents.find((event) => event.action === 'clock-in')
  const laterClockIn = sessionEvents.find((event) => event.action === 'clock-in' && event.id !== clockInEventId)
  const laterClockOut = sessionEvents.find((event) => event.action === 'clock-out')
  if (!firstClockIn || firstClockIn.id !== clockInEventId || laterClockIn || laterClockOut) {
    return json({ message: 'Der Dienst ist nicht mehr offen. Bitte die Zeiten neu laden.' }, 409)
  }

  const eventOutsideNewStart = sessionEvents.some((event) => {
    if (event.id === clockInEventId) return false
    const occurredAt = new Date(event.client_occurred_at).getTime()
    return !Number.isFinite(occurredAt) || occurredAt < newStart.getTime()
  })
  if (eventOutsideNewStart) {
    return json({ message: 'Der neue Arbeitsbeginn darf bestehende Pausenbuchungen nicht ausschließen.' }, 409)
  }

  const originalStart = new Date(selected.client_occurred_at)
  const currentPause = effectiveOpenPause(sessionEvents)
  const now = new Date().toISOString()
  const adjustmentId = `attendance-adjustment-open:${crypto.randomUUID()}`
  const auditId = `attendance-audit:${crypto.randomUUID()}`
  const before = { clockInAt: originalStart.toISOString(), clockOutAt: null, pauseMinutes: currentPause }
  const after = { clockInAt: newStart.toISOString(), clockOutAt: null, pauseMinutes }

  const rows = await sql.query(
    `WITH lock_user AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(hashtext($1)) AS locked
     ),
     state_ok AS MATERIALIZED (
       SELECT
         EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
              AND e.client_occurred_at = $3::timestamptz
         )
         AND COALESCE((
           SELECT e.id FROM attendance_events e CROSS JOIN lock_user
            WHERE e.user_id = $1 AND e.action = 'clock-in'
            ORDER BY e.client_occurred_at DESC, e.server_occurred_at DESC, e.id DESC
            LIMIT 1
         ), '') = $2
         AND NOT EXISTS (
           SELECT 1 FROM attendance_events e CROSS JOIN lock_user
            WHERE e.user_id = $1 AND e.action = 'clock-out'
              AND e.client_occurred_at > $3::timestamptz
         ) AS ok
     ),
     updated_clock_in AS (
       UPDATE attendance_events e
          SET client_occurred_at = $4::timestamptz, event_date = $5::date
         FROM state_ok
        WHERE state_ok.ok AND e.id = $2 AND e.user_id = $1 AND e.action = 'clock-in'
       RETURNING e.id
     ),
     created_adjustment AS (
       INSERT INTO attendance_adjustments
         (id, event_id, user_id, event_date, pause_minutes, reason,
          actor_id, actor_email, actor_role, occurred_at, expires_at)
       SELECT $6, $2, $1, $5::date, $7, $8, $9, $10, $11,
              $12::timestamptz, $12::timestamptz + interval '24 months'
         FROM updated_clock_in
       RETURNING id
     ),
     created_audit AS (
       INSERT INTO attendance_audit_log
         (id, occurred_at, actor_id, actor_email, actor_role, action,
          entity_type, entity_id, reason, before_data, after_data, expires_at)
       SELECT $13, $12::timestamptz, $9, $10, $11, 'admin-time-edit',
              'attendance_session', $2 || ':open', $8, $14::jsonb, $15::jsonb,
              $12::timestamptz + interval '24 months'
         FROM created_adjustment
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM created_audit) AS saved`,
    [
      selected.user_id,
      selected.id,
      originalStart.toISOString(),
      newStart.toISOString(),
      eventDateInBerlin(newStart),
      adjustmentId,
      pauseMinutes,
      AUTOMATIC_REASON,
      current.userId,
      current.email,
      current.role,
      now,
      auditId,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  )

  if (!rows[0]?.saved) return json({ message: 'Der laufende Dienst wurde zwischenzeitlich verändert. Bitte die Zeiten neu laden.' }, 409)
  return json({ saved: true, clockInEventId: selected.id, clockOutEventId: null, open: true })
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
  if (!clockInEventId) return json({ message: 'Arbeitsbeginn ist erforderlich.' }, 400)

  let newStart: Date
  let pauseMinutes: number
  try {
    newStart = parseRequiredDate(body.clockInAt, 'Arbeitsbeginn')
    pauseMinutes = parsePause(body.pauseMinutes)
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : 'Ungültige Zeitangaben.' }, 400)
  }

  const now = new Date()
  if (newStart.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return json({ message: 'Der Arbeitsbeginn darf nicht in der Zukunft liegen.' }, 400)

  const hasEnd = body.clockOutAt !== undefined && body.clockOutAt !== null && String(body.clockOutAt).trim() !== ''
  const hasExistingEnd = body.clockOutEventId !== undefined && body.clockOutEventId !== null && String(body.clockOutEventId).trim() !== ''
  if (hasEnd || hasExistingEnd) return proxyExistingEditor(request, body)

  return editOpenSessionWithoutEnd(current, clockInEventId, newStart, pauseMinutes)
}

export default async function attendanceTimeEditV2(request: Request, _context: Context) {
  return editTime(request)
}

export const config: Config = { path: '/api/attendance-time-edit-v2' }
