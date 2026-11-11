import { getDatabase } from '@netlify/database'

type TransferConflict = {
  date: string
  start: string
  end: string
  existingStart: string
  existingEnd: string
}

export type ScheduleIdentityTransferResult = {
  shiftCount: number
  publishedCount: number
  firstDate: string | null
  lastDate: string | null
  conflicts: TransferConflict[]
  moved: number
}

function dateText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

function timeText(value: unknown) {
  return String(value || '').slice(0, 5)
}

/**
 * Moves existing shift IDs rather than copying them. Publication state, shift dates,
 * sites, work areas, break times and original creation metadata stay unchanged.
 * If the destination is already assigned at an overlapping time, nothing is moved.
 *
 * preview=true never writes data. The real transfer is a single SQL transaction.
 */
export async function transferScheduleIdentity(input: {
  sourceUserId: string
  targetUserId: string
  targetName: string
  actorId: string
  preview: boolean
}): Promise<ScheduleIdentityTransferResult> {
  const database = getDatabase()
  const client = await database.pool.connect()
  const result: ScheduleIdentityTransferResult = {
    shiftCount: 0,
    publishedCount: 0,
    firstDate: null,
    lastDate: null,
    conflicts: [],
    moved: 0,
  }

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    // Lock both sets of shifts to avoid moving a stale set.
    const source = await client.query(
      `SELECT id, shift_date, start_time, end_time, status
         FROM schedule_shifts
        WHERE employee_user_id = $1
        ORDER BY shift_date, start_time, id
        FOR UPDATE`,
      [input.sourceUserId],
    )
    await client.query(
      `SELECT id FROM schedule_shifts
        WHERE employee_user_id = $1
        ORDER BY shift_date, id
        FOR UPDATE`,
      [input.targetUserId],
    )

    result.shiftCount = source.rows.length
    result.publishedCount = source.rows.filter((row) => row.status === 'published').length
    result.firstDate = source.rows.length ? dateText(source.rows[0].shift_date) : null
    result.lastDate = source.rows.length ? dateText(source.rows[source.rows.length - 1].shift_date) : null

    const overlapping = await client.query(
      `SELECT guest.shift_date, guest.start_time, guest.end_time,
              destination.start_time AS existing_start, destination.end_time AS existing_end
         FROM schedule_shifts guest
         JOIN schedule_shifts destination
           ON destination.employee_user_id = $2
          AND destination.shift_date = guest.shift_date
          AND destination.start_time < guest.end_time
          AND guest.start_time < destination.end_time
        WHERE guest.employee_user_id = $1
        ORDER BY guest.shift_date, guest.start_time
        LIMIT 20`,
      [input.sourceUserId, input.targetUserId],
    )
    result.conflicts = overlapping.rows.map((row) => ({
      date: dateText(row.shift_date),
      start: timeText(row.start_time),
      end: timeText(row.end_time),
      existingStart: timeText(row.existing_start),
      existingEnd: timeText(row.existing_end),
    }))
    if (input.preview || result.conflicts.length || !result.shiftCount) {
      await client.query('ROLLBACK')
      return result
    }

    const moved = await client.query(
      `UPDATE schedule_shifts
          SET employee_user_id = $2,
              employee_name = $3,
              updated_at = now(),
              updated_by = $4
        WHERE employee_user_id = $1
        RETURNING id`,
      [input.sourceUserId, input.targetUserId, input.targetName, input.actorId],
    )
    result.moved = moved.rowCount || 0
    if (result.moved !== result.shiftCount) throw new Error('Die Dienstplanzahl hat sich während der Übertragung geändert.')

    await client.query(
      `INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)
       VALUES ($1, now(), $2, 'portal', 'employee-schedule-transfer', NULL, $3::jsonb)`,
      [
        crypto.randomUUID(),
        input.actorId,
        JSON.stringify({
          sourceUserId: input.sourceUserId,
          targetUserId: input.targetUserId,
          targetName: input.targetName,
          shiftsMoved: result.moved,
          publishedCount: result.publishedCount,
          firstDate: result.firstDate,
          lastDate: result.lastDate,
        }),
      ],
    )
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
