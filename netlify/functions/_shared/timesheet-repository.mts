import { getDatabase } from '@netlify/database'

export type TimesheetEntry = {
  id: string
  scheduleShiftId: string | null
  employeeUserId: string
  employeeName: string
  workDate: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  workArea: string
  source: 'schedule' | 'manual'
  manualOverride: boolean
  suppressed: boolean
  suppressedAt: string
  suppressedBy: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type ScheduleTimesheetInput = Omit<
  TimesheetEntry,
  'id' | 'suppressed' | 'suppressedAt' | 'suppressedBy' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'
> & {
  scheduleShiftId: string
}

function iso(value: unknown) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value)
}

function dateOnly(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

function timeOnly(value: unknown) {
  return String(value || '').slice(0, 5)
}

export function mapTimesheetEntryRow(row: Record<string, unknown>): TimesheetEntry {
  return {
    id: String(row.id || ''),
    scheduleShiftId: row.schedule_shift_id == null ? null : String(row.schedule_shift_id),
    employeeUserId: String(row.employee_user_id || ''),
    employeeName: String(row.employee_name || ''),
    workDate: dateOnly(row.work_date),
    start: timeOnly(row.start_time),
    end: timeOnly(row.end_time),
    pauseMinutes: Number(row.pause_minutes || 0),
    netMinutes: Number(row.net_minutes || 0),
    location: String(row.location || ''),
    workArea: String(row.work_area || ''),
    source: row.source === 'manual' ? 'manual' : 'schedule',
    manualOverride: Boolean(row.manual_override),
    suppressed: Boolean(row.suppressed),
    suppressedAt: iso(row.suppressed_at),
    suppressedBy: String(row.suppressed_by || ''),
    createdAt: iso(row.created_at),
    createdBy: String(row.created_by || ''),
    updatedAt: iso(row.updated_at),
    updatedBy: String(row.updated_by || ''),
  }
}

export async function ensureTimesheetMonth(monthKey: string, correctionDeadline: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO timesheet_months (month_key, correction_deadline)
     VALUES ($1, $2::date)
     ON CONFLICT (month_key) DO UPDATE SET
       correction_deadline = EXCLUDED.correction_deadline,
       updated_at = now()
     RETURNING month_key, correction_deadline, closed_at`,
    [monthKey, correctionDeadline],
  )
  return result.rows[0] || null
}

export async function listTimesheetEntries(filters: { from: string; to: string; employeeUserId?: string }) {
  const params: unknown[] = [filters.from, filters.to]
  let employeeClause = ''
  if (filters.employeeUserId) {
    params.push(filters.employeeUserId)
    employeeClause = ` AND employee_user_id = $${params.length}`
  }
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM timesheet_entries
      WHERE work_date BETWEEN $1::date AND $2::date
        AND suppressed = false${employeeClause}
      ORDER BY work_date, start_time, employee_name, id`,
    params,
  )
  return result.rows.map((row) => mapTimesheetEntryRow(row))
}

export async function listScheduleLinkedTimesheetEntries(filters: { from: string; to: string }) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM timesheet_entries
      WHERE work_date BETWEEN $1::date AND $2::date
        AND schedule_shift_id IS NOT NULL
      ORDER BY work_date, start_time, employee_name, id`,
    [filters.from, filters.to],
  )
  return result.rows.map((row) => mapTimesheetEntryRow(row))
}

export async function findTimesheetEntryByScheduleShiftId(shiftId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    'SELECT * FROM timesheet_entries WHERE schedule_shift_id = $1 LIMIT 1',
    [shiftId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function upsertScheduleTimesheetEntry(entry: ScheduleTimesheetInput, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO timesheet_entries (
       id, schedule_shift_id, employee_user_id, employee_name, work_date,
       start_time, end_time, pause_minutes, net_minutes, location, work_area,
       source, manual_override, created_at, created_by, updated_at, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5::date,
       $6::time, $7::time, $8, $9, $10, $11,
       'schedule', false, now(), $12, now(), $12
     )
     ON CONFLICT (schedule_shift_id) WHERE schedule_shift_id IS NOT NULL DO UPDATE SET
       employee_user_id = EXCLUDED.employee_user_id,
       employee_name = EXCLUDED.employee_name,
       work_date = EXCLUDED.work_date,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       pause_minutes = EXCLUDED.pause_minutes,
       net_minutes = EXCLUDED.net_minutes,
       location = EXCLUDED.location,
       work_area = EXCLUDED.work_area,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     WHERE timesheet_entries.manual_override = false
       AND timesheet_entries.suppressed = false
     RETURNING *`,
    [
      crypto.randomUUID(), entry.scheduleShiftId, entry.employeeUserId, entry.employeeName,
      entry.workDate, entry.start, entry.end, entry.pauseMinutes, entry.netMinutes,
      entry.location, entry.workArea, actorId,
    ],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function deleteScheduleTimesheetEntryByShiftId(shiftId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `DELETE FROM timesheet_entries
      WHERE schedule_shift_id = $1 AND manual_override = false
      RETURNING *`,
    [shiftId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function writeTimesheetAudit(input: {
  actorId: string
  actorRole: string
  action: string
  entryId?: string | null
  monthKey: string
  reason?: string | null
  beforeData?: unknown
  afterData?: unknown
}) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO timesheet_audit_log (
       id, occurred_at, actor_id, actor_role, action, entry_id, month_key,
       reason, before_data, after_data
     ) VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
    [
      crypto.randomUUID(), input.actorId, input.actorRole, input.action,
      input.entryId || null, input.monthKey, input.reason || null,
      input.beforeData === undefined ? null : JSON.stringify(input.beforeData),
      input.afterData === undefined ? null : JSON.stringify(input.afterData),
    ],
  )
}
