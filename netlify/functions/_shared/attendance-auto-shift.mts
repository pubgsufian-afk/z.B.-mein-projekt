import { getDatabase } from '@netlify/database'

export type FlexWorksite = {
  id: string
  name: string
}

export type FlexShiftRecord = {
  id: string
  employeeUserId: string
  employeeName: string
  date: string
  start: string
  end: string
  pauseMinutes: number
  objectId: string
  location: string
  workArea: string
  note: string
  status: 'published'
  version: number
  source: 'attendance-flex'
  sourceRef: string
}

export function berlinDateTimeParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Ungültiger Zeitpunkt.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

export function buildFlexShiftRecord(input: {
  scheduleId: string
  userId: string
  fullName: string
  checkInAt: string | Date
  deadlineAt: string | Date
  worksite: FlexWorksite
  sourceRef: string
}): FlexShiftRecord {
  const start = berlinDateTimeParts(input.checkInAt)
  const end = berlinDateTimeParts(input.deadlineAt)
  const scheduleId = String(input.scheduleId || '').trim()
  const userId = String(input.userId || '').trim()
  const fullName = String(input.fullName || '').trim()
  const objectId = String(input.worksite?.id || '').trim()
  const location = String(input.worksite?.name || '').trim()
  const sourceRef = String(input.sourceRef || '').trim()
  if (!scheduleId || !userId || !fullName || !objectId || !location || !sourceRef) throw new TypeError('Flex-Dienst ist unvollständig.')
  return {
    id: scheduleId,
    employeeUserId: userId,
    employeeName: fullName,
    date: start.date,
    start: start.time,
    end: end.time,
    pauseMinutes: 0,
    objectId,
    location,
    workArea: 'Zeiterfassung',
    note: 'Automatisch aus der Zeiterfassung erstellt.',
    status: 'published',
    version: 0,
    source: 'attendance-flex',
    sourceRef,
  }
}

export async function createFlexAutoShift(input: Parameters<typeof buildFlexShiftRecord>[0]) {
  const shift = buildFlexShiftRecord(input)
  const database = getDatabase()
  const now = new Date().toISOString()
  const result = await database.pool.query(
    `INSERT INTO schedule_shifts (
       id, employee_user_id, employee_name, shift_date, start_time, end_time,
       pause_minutes, object_id, location, work_area, note, status, version,
       template_id, repeat_group_id, created_at, created_by, updated_at, updated_by,
       published_at, published_by, source, source_ref
     ) VALUES (
       $1,$2,$3,$4::date,$5::time,$6::time,$7,$8,$9,$10,$11,'published',0,
       NULL,NULL,$12::timestamptz,'system:attendance-flex',$12::timestamptz,'system:attendance-flex',
       $12::timestamptz,'system:attendance-flex','attendance-flex',$13
     )
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [shift.id, shift.employeeUserId, shift.employeeName, shift.date, shift.start, shift.end,
      shift.pauseMinutes, shift.objectId, shift.location, shift.workArea, shift.note, now, shift.sourceRef],
  )
  const created = Boolean(result.rows[0])
  const existing = await database.pool.query(
    `SELECT id, employee_user_id, employee_name, source, source_ref FROM schedule_shifts WHERE id = $1 LIMIT 1`,
    [shift.id],
  )
  const row = existing.rows[0]
  if (!row || row.employee_user_id !== shift.employeeUserId || row.source !== 'attendance-flex' || row.source_ref !== shift.sourceRef) {
    throw new Error('Der automatisch erzeugte Dienst kollidiert mit einem bestehenden Eintrag.')
  }
  if (created) {
    await database.pool.query(
      `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
       VALUES ($1, now(), 'system:attendance-flex', 'system', 'attendance-flex-created', $2, $3::jsonb)`,
      [crypto.randomUUID(), shift.id, JSON.stringify({ employeeUserId: shift.employeeUserId, sourceRef: shift.sourceRef })],
    )
  }
  return { shift, created }
}

export async function finishFlexAutoShift(scheduleId: string, employeeUserId: string, endAt: string | Date) {
  const end = berlinDateTimeParts(endAt)
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE schedule_shifts
        SET end_time = $3::time, updated_at = now(), updated_by = 'system:attendance-flex'
      WHERE id = $1 AND employee_user_id = $2 AND source = 'attendance-flex'
      RETURNING id`,
    [scheduleId, employeeUserId, end.time],
  )
  if (result.rows[0]) {
    await database.pool.query(
      `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
       VALUES ($1, now(), 'system:attendance-flex', 'system', 'attendance-flex-finished', $2, $3::jsonb)`,
      [crypto.randomUUID(), scheduleId, JSON.stringify({ employeeUserId, endAt: new Date(endAt).toISOString() })],
    )
  }
  return Boolean(result.rows[0])
}

export async function deleteFlexAutoShift(scheduleId: string, employeeUserId: string, sourceRef: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `DELETE FROM schedule_shifts
      WHERE id = $1 AND employee_user_id = $2 AND source = 'attendance-flex' AND source_ref = $3
      RETURNING id`,
    [scheduleId, employeeUserId, sourceRef],
  )
  return Boolean(result.rows[0])
}

export async function findScheduleTiming(scheduleId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT s.*,
       ((s.shift_date + s.start_time) AT TIME ZONE 'Europe/Berlin') AS scheduled_start_at,
       ((s.shift_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 day' END)
         AT TIME ZONE 'Europe/Berlin') AS scheduled_end_at
       FROM schedule_shifts s WHERE s.id = $1 LIMIT 1`,
    [scheduleId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    employeeUserId: String(row.employee_user_id),
    source: String(row.source || 'portal'),
    scheduledStartAt: new Date(row.scheduled_start_at).toISOString(),
    scheduledEndAt: new Date(row.scheduled_end_at).toISOString(),
  }
}

export async function nextPublishedShiftStart(employeeUserId: string, afterAt: string | Date) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') AS scheduled_start_at
       FROM schedule_shifts
      WHERE employee_user_id = $1 AND status = 'published'
        AND ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') > $2::timestamptz
      ORDER BY scheduled_start_at ASC LIMIT 1`,
    [employeeUserId, new Date(afterAt).toISOString()],
  )
  return result.rows[0]?.scheduled_start_at ? new Date(result.rows[0].scheduled_start_at).toISOString() : null
}

export async function writeAutomationScheduleAudit(action: string, shiftId: string, details: Record<string, unknown>) {
  const database = getDatabase()
  await database.pool.query(
    `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
     VALUES ($1, now(), 'system:auto-checkout', 'system', $2, $3, $4::jsonb)`,
    [crypto.randomUUID(), action, shiftId || null, JSON.stringify(details || {})],
  )
}
