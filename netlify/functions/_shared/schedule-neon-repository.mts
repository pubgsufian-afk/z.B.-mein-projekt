import { getDatabase } from '@netlify/database'
import { isProvisionalEmployeeUserId } from './schedule-provisional-employee.mts'

export type ScheduleStatus = 'draft' | 'published'
export type ScheduleSource = 'portal' | 'chatgpt' | 'legacy-blob'

export type ScheduleShift = {
  id: string
  employeeUserId: string
  employeeName: string
  date: string
  start: string
  end: string
  location: string
  workArea: string
  pauseMinutes: number
  note: string
  objectId: string | null
  status: ScheduleStatus
  version: number
  templateId: string | null
  repeatGroupId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  publishedAt: string | null
  publishedBy: string | null
  source: ScheduleSource
  sourceRef: string | null
}

export type ScheduleEmployee = {
  userId: string
  fullName: string
  role: 'owner' | 'admin' | 'manager' | 'scheduler' | 'employee'
  status: 'active' | 'inactive'
  location: string
  syncedAt?: string
}

export type ProvisionalScheduleEmployee = {
  userId: string
  fullName: string
}

function iso(value: unknown) {
  if (!value) return null
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

export function mapScheduleShiftRow(row: Record<string, unknown>): ScheduleShift {
  return {
    id: String(row.id),
    employeeUserId: String(row.employee_user_id),
    employeeName: String(row.employee_name),
    date: dateOnly(row.shift_date),
    start: timeOnly(row.start_time),
    end: timeOnly(row.end_time),
    pauseMinutes: Number(row.pause_minutes || 0),
    objectId: row.object_id == null ? null : String(row.object_id),
    location: String(row.location || ''),
    workArea: String(row.work_area || ''),
    note: String(row.note || ''),
    status: row.status === 'published' ? 'published' : 'draft',
    version: Number(row.version || 0),
    templateId: row.template_id == null ? null : String(row.template_id),
    repeatGroupId: row.repeat_group_id == null ? null : String(row.repeat_group_id),
    createdAt: iso(row.created_at) || '',
    createdBy: String(row.created_by || ''),
    updatedAt: iso(row.updated_at) || '',
    updatedBy: String(row.updated_by || ''),
    publishedAt: iso(row.published_at),
    publishedBy: row.published_by == null ? null : String(row.published_by),
    source: row.source === 'chatgpt' ? 'chatgpt' : row.source === 'legacy-blob' ? 'legacy-blob' : 'portal',
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
  }
}

export async function listScheduleShifts(filters: {
  from?: string
  to?: string
  employeeUserId?: string
  publishedOnly?: boolean
} = {}) {
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (clause: string, value: unknown) => {
    params.push(value)
    clauses.push(clause.replace('?', `$${params.length}`))
  }
  if (filters.from) add('shift_date >= ?::date', filters.from)
  if (filters.to) add('shift_date <= ?::date', filters.to)
  if (filters.employeeUserId) add('employee_user_id = ?', filters.employeeUserId)
  if (filters.publishedOnly) clauses.push("status = 'published'")
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM schedule_shifts${where} ORDER BY shift_date, start_time, employee_name, id`,
    params,
  )
  return result.rows.map((row) => mapScheduleShiftRow(row))
}

export async function listProvisionalScheduleEmployees(): Promise<ProvisionalScheduleEmployee[]> {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT DISTINCT employee_user_id, employee_name
       FROM schedule_shifts
      WHERE employee_user_id LIKE 'guest:%'
      ORDER BY employee_user_id, employee_name`,
  )
  return result.rows.map((row) => ({
    userId: String(row.employee_user_id || ''),
    fullName: String(row.employee_name || ''),
  }))
}

export async function rebindProvisionalEmployeeIdentity(input: {
  provisionalUserId: string
  userId: string
  fullName: string
  actorId: string
}) {
  const provisionalUserId = String(input.provisionalUserId || '').trim()
  const userId = String(input.userId || '').trim()
  const fullName = String(input.fullName || '').trim()
  const actorId = String(input.actorId || '').trim() || 'identity-rebind'
  if (!isProvisionalEmployeeUserId(provisionalUserId) || !userId || isProvisionalEmployeeUserId(userId) || !fullName) {
    return { rebound: false, reason: 'invalid', shiftCount: 0, timesheetCount: 0 }
  }

  const database = getDatabase()
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    const conflict = await client.query(
      `SELECT guest.id
         FROM schedule_shifts guest
         JOIN schedule_shifts existing
           ON existing.employee_user_id = $2
          AND existing.id <> guest.id
          AND existing.shift_date = guest.shift_date
          AND existing.start_time = guest.start_time
          AND existing.end_time = guest.end_time
          AND lower(btrim(existing.location)) = lower(btrim(guest.location))
          AND lower(btrim(existing.work_area)) = lower(btrim(guest.work_area))
        WHERE guest.employee_user_id = $1
        LIMIT 1`,
      [provisionalUserId, userId],
    )
    if (conflict.rows.length) {
      await client.query('ROLLBACK')
      return { rebound: false, reason: 'duplicate-conflict', shiftCount: 0, timesheetCount: 0 }
    }

    const shifts = await client.query(
      `UPDATE schedule_shifts
          SET employee_user_id = $2,
              employee_name = $3,
              updated_at = now(),
              updated_by = $4
        WHERE employee_user_id = $1
        RETURNING id`,
      [provisionalUserId, userId, fullName, actorId],
    )
    const timesheets = await client.query(
      `UPDATE timesheet_entries
          SET employee_user_id = $2,
              employee_name = $3,
              updated_at = now(),
              updated_by = $4
        WHERE employee_user_id = $1
        RETURNING id`,
      [provisionalUserId, userId, fullName, actorId],
    )
    const shiftCount = shifts.rowCount || 0
    const timesheetCount = timesheets.rowCount || 0
    if (shiftCount || timesheetCount) {
      await client.query(
        `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
         VALUES ($1, now(), $2, 'chatgpt', 'provisional-employee-rebound', NULL, $3::jsonb)`,
        [
          crypto.randomUUID(),
          actorId,
          JSON.stringify({ provisionalUserId, userId, shiftCount, timesheetCount }),
        ],
      )
    }
    await client.query('COMMIT')
    return { rebound: true, reason: shiftCount || timesheetCount ? 'rebound' : 'not-found', shiftCount, timesheetCount }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function findScheduleShift(id: string) {
  const database = getDatabase()
  const result = await database.pool.query('SELECT * FROM schedule_shifts WHERE id = $1 LIMIT 1', [id])
  return result.rows[0] ? mapScheduleShiftRow(result.rows[0]) : null
}

export async function findExactScheduleDuplicate(candidate: Pick<ScheduleShift, 'employeeUserId' | 'date' | 'start' | 'end' | 'location' | 'workArea'>, excludeId = '') {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM schedule_shifts
      WHERE employee_user_id = $1
        AND shift_date = $2::date
        AND start_time = $3::time
        AND end_time = $4::time
        AND lower(btrim(location)) = lower(btrim($5))
        AND lower(btrim(work_area)) = lower(btrim($6))
        AND ($7 = '' OR id <> $7)
      LIMIT 1`,
    [candidate.employeeUserId, candidate.date, candidate.start, candidate.end, candidate.location, candidate.workArea, excludeId],
  )
  return result.rows[0] ? mapScheduleShiftRow(result.rows[0]) : null
}

export async function listScheduleOverlaps(candidate: Pick<ScheduleShift, 'employeeUserId' | 'date' | 'start' | 'end'>, excludeId = '') {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM schedule_shifts
      WHERE employee_user_id = $1
        AND shift_date = $2::date
        AND start_time < $4::time
        AND $3::time < end_time
        AND ($5 = '' OR id <> $5)
      ORDER BY start_time, id`,
    [candidate.employeeUserId, candidate.date, candidate.start, candidate.end, excludeId],
  )
  return result.rows.map((row) => mapScheduleShiftRow(row))
}

export async function upsertScheduleShift(shift: ScheduleShift) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO schedule_shifts (
       id, employee_user_id, employee_name, shift_date, start_time, end_time,
       pause_minutes, object_id, location, work_area, note, status, version,
       template_id, repeat_group_id, created_at, created_by, updated_at, updated_by,
       published_at, published_by, source, source_ref
     ) VALUES (
       $1, $2, $3, $4::date, $5::time, $6::time,
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16::timestamptz, $17, $18::timestamptz, $19,
       $20::timestamptz, $21, $22, $23
     )
     ON CONFLICT (id) DO UPDATE SET
       employee_user_id = EXCLUDED.employee_user_id,
       employee_name = EXCLUDED.employee_name,
       shift_date = EXCLUDED.shift_date,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       pause_minutes = EXCLUDED.pause_minutes,
       object_id = EXCLUDED.object_id,
       location = EXCLUDED.location,
       work_area = EXCLUDED.work_area,
       note = EXCLUDED.note,
       status = EXCLUDED.status,
       version = EXCLUDED.version,
       template_id = EXCLUDED.template_id,
       repeat_group_id = EXCLUDED.repeat_group_id,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by,
       published_at = EXCLUDED.published_at,
       published_by = EXCLUDED.published_by,
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref
     RETURNING *`,
    [
      shift.id, shift.employeeUserId, shift.employeeName, shift.date, shift.start, shift.end,
      shift.pauseMinutes, shift.objectId, shift.location, shift.workArea, shift.note, shift.status, shift.version,
      shift.templateId, shift.repeatGroupId, shift.createdAt, shift.createdBy, shift.updatedAt, shift.updatedBy,
      shift.publishedAt, shift.publishedBy, shift.source, shift.sourceRef,
    ],
  )
  return mapScheduleShiftRow(result.rows[0])
}

export async function deleteScheduleShift(id: string) {
  const database = getDatabase()
  const result = await database.pool.query('DELETE FROM schedule_shifts WHERE id = $1 RETURNING id', [id])
  return Boolean(result.rows[0])
}

export async function publishScheduleWeek(weekStart: string, actorId: string) {
  const database = getDatabase()
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    const rows = await client.query(
      `SELECT id FROM schedule_shifts
        WHERE shift_date BETWEEN $1::date AND ($1::date + 6)
        ORDER BY shift_date, start_time, id
        FOR UPDATE`,
      [weekStart],
    )
    if (!rows.rows.length) {
      await client.query('ROLLBACK')
      return { published: 0, version: 0, shiftIds: [] as string[] }
    }
    const versionResult = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM schedule_versions WHERE week_start = $1::date',
      [weekStart],
    )
    const version = Number(versionResult.rows[0]?.next_version || 1)
    const now = new Date().toISOString()
    const shiftIds = rows.rows.map((row) => String(row.id))
    await client.query(
      `UPDATE schedule_shifts
          SET status = 'published', version = $2, published_at = $3::timestamptz,
              published_by = $4, updated_at = $3::timestamptz, updated_by = $4
        WHERE shift_date BETWEEN $1::date AND ($1::date + 6)`,
      [weekStart, version, now, actorId],
    )
    await client.query(
      `INSERT INTO schedule_versions (week_start, version, published_at, published_by, shift_ids)
       VALUES ($1::date, $2, $3::timestamptz, $4, $5::jsonb)`,
      [weekStart, version, now, actorId, JSON.stringify(shiftIds)],
    )
    await client.query('COMMIT')
    return { published: shiftIds.length, version, shiftIds }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function upsertScheduleVersion(version: { week: string; version: number; publishedAt: string; publishedBy: string; shiftIds: string[] }) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO schedule_versions (week_start, version, published_at, published_by, shift_ids)
     VALUES ($1::date, $2, $3::timestamptz, $4, $5::jsonb)
     ON CONFLICT (week_start, version) DO NOTHING`,
    [version.week, version.version, version.publishedAt, version.publishedBy, JSON.stringify(version.shiftIds)],
  )
}

export async function listScheduleVersions() {
  const database = getDatabase()
  const result = await database.pool.query(
    'SELECT week_start, version, published_at, published_by, shift_ids FROM schedule_versions ORDER BY week_start DESC, version DESC',
  )
  return result.rows.map((row) => ({
    week: dateOnly(row.week_start),
    version: Number(row.version),
    publishedAt: iso(row.published_at),
    publishedBy: String(row.published_by),
    shiftIds: Array.isArray(row.shift_ids) ? row.shift_ids.map(String) : [],
  }))
}

export async function syncScheduleEmployees(employees: ScheduleEmployee[], markMissingInactive = true) {
  const clean = employees.filter((employee) => employee.userId && employee.fullName && employee.status === 'active')
  const database = getDatabase()
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    if (markMissingInactive) {
      if (clean.length) {
        await client.query(
          `UPDATE schedule_employees
              SET status = 'inactive', synced_at = now()
            WHERE status = 'active' AND NOT (user_id = ANY($1::text[]))`,
          [clean.map((employee) => employee.userId)],
        )
      } else {
        await client.query("UPDATE schedule_employees SET status = 'inactive', synced_at = now() WHERE status = 'active'")
      }
    }
    for (const employee of clean) {
      await client.query(
        `INSERT INTO schedule_employees (user_id, full_name, role, status, location, synced_at)
         VALUES ($1, $2, $3, 'active', $4, now())
         ON CONFLICT (user_id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           status = 'active',
           location = EXCLUDED.location,
           synced_at = now()`,
        [employee.userId, employee.fullName, employee.role, employee.location],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return clean.length
}

export async function upsertScheduleEmployee(employee: ScheduleEmployee) {
  return syncScheduleEmployees([employee], false)
}

export async function listActiveScheduleEmployees() {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT user_id, full_name, role, status, location, synced_at
       FROM schedule_employees
      WHERE status = 'active'
      ORDER BY lower(full_name), user_id`,
  )
  return result.rows.map((row) => ({
    userId: String(row.user_id),
    id: String(row.user_id),
    fullName: String(row.full_name),
    role: String(row.role),
    status: String(row.status),
    location: String(row.location || ''),
    syncedAt: iso(row.synced_at),
  }))
}

export async function hasScheduleMigration(migrationKey: string) {
  const database = getDatabase()
  const result = await database.pool.query('SELECT migration_key FROM schedule_migrations WHERE migration_key = $1 LIMIT 1', [migrationKey])
  return Boolean(result.rows[0])
}

export async function markScheduleMigration(migrationKey: string, details: Record<string, unknown> = {}) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO schedule_migrations (migration_key, completed_at, details)
     VALUES ($1, now(), $2::jsonb)
     ON CONFLICT (migration_key) DO UPDATE SET completed_at = EXCLUDED.completed_at, details = EXCLUDED.details`,
    [migrationKey, JSON.stringify(details)],
  )
}

export async function writeScheduleAudit(input: {
  actorId: string
  actorType: 'portal' | 'chatgpt' | 'migration'
  action: string
  shiftId?: string | null
  details?: Record<string, unknown>
}) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
     VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb)`,
    [crypto.randomUUID(), input.actorId, input.actorType, input.action, input.shiftId || null, JSON.stringify(input.details || {})],
  )
}
