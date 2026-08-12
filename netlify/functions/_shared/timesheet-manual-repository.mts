import { getDatabase } from '@netlify/database'
import { mapTimesheetEntryRow } from './timesheet-repository.mts'

export async function findTimesheetEntry(id: string) {
  const database = getDatabase()
  const result = await database.pool.query('SELECT * FROM timesheet_entries WHERE id = $1 LIMIT 1', [id])
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function createManualTimesheetEntry(input: {
  employeeUserId: string
  employeeName: string
  workDate: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  workArea: string
}, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO timesheet_entries (
       id, schedule_shift_id, employee_user_id, employee_name, work_date,
       start_time, end_time, pause_minutes, net_minutes, location, work_area,
       source, manual_override, created_at, created_by, updated_at, updated_by
     ) VALUES ($1, NULL, $2, $3, $4::date, $5::time, $6::time, $7, $8, $9, $10,
               'manual', true, now(), $11, now(), $11)
     RETURNING *`,
    [crypto.randomUUID(), input.employeeUserId, input.employeeName, input.workDate, input.start, input.end,
      input.pauseMinutes, input.netMinutes, input.location, input.workArea, actorId],
  )
  return mapTimesheetEntryRow(result.rows[0])
}

export async function updateManualTimesheetEntry(id: string, input: {
  employeeUserId: string
  employeeName: string
  workDate: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  workArea: string
}, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE timesheet_entries SET
       employee_user_id = $2,
       employee_name = $3,
       work_date = $4::date,
       start_time = $5::time,
       end_time = $6::time,
       pause_minutes = $7,
       net_minutes = $8,
       location = $9,
       work_area = $10,
       source = 'manual',
       manual_override = true,
       updated_at = now(),
       updated_by = $11
     WHERE id = $1
     RETURNING *`,
    [id, input.employeeUserId, input.employeeName, input.workDate, input.start, input.end,
      input.pauseMinutes, input.netMinutes, input.location, input.workArea, actorId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function deleteManualTimesheetEntry(id: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `DELETE FROM timesheet_entries
      WHERE id = $1 AND source = 'manual' AND schedule_shift_id IS NULL
      RETURNING *`,
    [id],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function suppressTimesheetEntry(id: string, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE timesheet_entries SET
       suppressed = true,
       suppressed_at = now(),
       suppressed_by = $2,
       manual_override = true,
       updated_at = now(),
       updated_by = $2
     WHERE id = $1
     RETURNING *`,
    [id, actorId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function restoreScheduleTimesheetEntry(id: string, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE timesheet_entries SET
       suppressed = false,
       suppressed_at = NULL,
       suppressed_by = NULL,
       source = 'schedule',
       manual_override = false,
       updated_at = now(),
       updated_by = $2
     WHERE id = $1
       AND schedule_shift_id IS NOT NULL
     RETURNING *`,
    [id, actorId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}
