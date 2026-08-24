import { getDatabase } from '@netlify/database'
import { databaseConnectionString } from './database-connection.mts'

function text(value: unknown) {
  return String(value ?? '').trim()
}

function dateOnly(value: unknown) {
  return String(value || '').slice(0, 10)
}

function timeOnly(value: unknown) {
  return String(value || '').slice(0, 5)
}

export async function listLegacyTimesheetEntries(filters: {
  from: string
  to: string
  employeeUserId: string
}) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT id, schedule_shift_id, employee_user_id, employee_name, work_date,
            start_time, end_time, pause_minutes, net_minutes, location, work_area,
            source, manual_override
       FROM timesheet_entries
      WHERE work_date BETWEEN $1::date AND $2::date
        AND employee_user_id = $3
      ORDER BY work_date, start_time, id`,
    [filters.from, filters.to, filters.employeeUserId],
  )
  return result.rows.map((row) => ({
    id: text(row.id),
    scheduleShiftId: row.schedule_shift_id == null ? null : text(row.schedule_shift_id),
    employeeUserId: text(row.employee_user_id),
    employeeName: text(row.employee_name),
    date: dateOnly(row.work_date),
    start: timeOnly(row.start_time),
    end: timeOnly(row.end_time),
    pauseMinutes: Number(row.pause_minutes || 0),
    netMinutes: Number(row.net_minutes || 0),
    location: text(row.location),
    workArea: text(row.work_area),
    source: text(row.source),
    manualOverride: row.manual_override === true,
  }))
}

export async function listAttendanceHistory(filters: {
  from: string
  to: string
  employeeUserId: string
}) {
  const connection = databaseConnectionString()
  if (!connection) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(connection)
  const rows = await sql.query(
    `SELECT e.id, e.user_id, e.client_event_id, e.action,
            e.server_occurred_at, e.client_occurred_at, e.event_date,
            e.schedule_id, e.object_id, e.location_status, e.offline_captured,
            adjustment.pause_minutes AS pause_minutes_adjustment,
            adjustment.reason AS pause_adjustment_reason,
            adjustment.occurred_at AS pause_adjustment_occurred_at
       FROM attendance_events e
       LEFT JOIN LATERAL (
         SELECT a.pause_minutes, a.reason, a.occurred_at
           FROM attendance_adjustments a
          WHERE a.event_id = e.id
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT 1
       ) adjustment ON true
      WHERE e.event_date BETWEEN $1::date AND $2::date
        AND e.user_id = $3
      ORDER BY e.event_date, e.client_occurred_at, e.server_occurred_at, e.id`,
    [filters.from, filters.to, filters.employeeUserId],
  )
  return rows.map((row) => ({
    id: text(row.id),
    userId: text(row.user_id),
    clientEventId: text(row.client_event_id),
    action: text(row.action),
    serverOccurredAt: new Date(String(row.server_occurred_at)).toISOString(),
    clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString(),
    eventDate: dateOnly(row.event_date),
    scheduleId: row.schedule_id == null ? null : text(row.schedule_id),
    objectId: row.object_id == null ? null : text(row.object_id),
    locationStatus: text(row.location_status),
    offlineCaptured: row.offline_captured === true,
    pauseMinutesAdjustment: row.pause_minutes_adjustment == null ? null : Number(row.pause_minutes_adjustment),
    pauseAdjustmentReason: text(row.pause_adjustment_reason),
    pauseAdjustmentOccurredAt: row.pause_adjustment_occurred_at
      ? new Date(String(row.pause_adjustment_occurred_at)).toISOString()
      : null,
  }))
}
