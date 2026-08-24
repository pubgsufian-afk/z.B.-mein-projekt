import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import {
  AttendanceAdminError,
  attendanceAdminService,
  type AttendanceAdminActor,
} from './_shared/attendance-admin-service.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import { listScheduleShifts } from './_shared/schedule-neon-repository.mts'
import {
  detectAttendanceDuplicates,
  type AttendanceEmployeeSnapshot,
  type AttendanceEventSnapshot,
} from './_shared/attendance-assistant-core.mts'

const MAX_ATTENDANCE_RANGE_DAYS = 62
const RELAY_ACTOR: AttendanceAdminActor = {
  userId: 'portal-admin-relay',
  email: 'portal-admin-relay@internal.invalid',
  role: 'owner',
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

async function listOrDiagnose(action: string, body: Record<string, unknown>) {
  const from = text(body.from)
  const to = text(body.to)
  if (!validAttendanceRange(from, to)) return json({ message: 'Zeiterfassungs-Zeitraum ist ungültig.' }, 400)

  let sql: Awaited<ReturnType<typeof connection>>
  try {
    sql = await connection()
  } catch (error: any) {
    return json({ message: error.message }, error.status || 500)
  }

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

export default async function attendanceAssistant(request: Request, _context: Context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  if (!authorized(request)) return json({ message: 'Nicht autorisiert.' }, 401)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = text(body.action)

  try {
    if (action === 'list-attendance' || action === 'find-attendance-duplicates') {
      return await listOrDiagnose(action, body)
    }
    if (action === 'update-attendance-session') {
      const result = await attendanceAdminService().updateSession({
        clockInEventId: text(body.clockInEventId),
        clockOutEventId: text(body.clockOutEventId) || null,
        clockInAt: text(body.clockInAt),
        clockOutAt: text(body.clockOutAt) || null,
        pauseMinutes: Number(body.pauseMinutes),
        reason: text(body.reason),
      }, RELAY_ACTOR)
      return json({ action, ...result })
    }
    if (action === 'delete-attendance-events') {
      const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(text).filter(Boolean) : []
      const result = await attendanceAdminService().deleteEvents({ eventIds, reason: text(body.reason) }, RELAY_ACTOR)
      return json({ action, ...result })
    }
    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    if (error instanceof AttendanceAdminError) return json({ message: error.message }, error.status)
    console.error('Habun attendance assistant', error)
    return json({ message: 'Der Zeiterfassungs-Auftrag konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-assistant' }
