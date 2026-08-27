import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { notifyShiftStartingSoon } from './_shared/schedule-push.mts'
import { scheduleReminderKey, shouldReleaseReminderClaim } from './_shared/schedule-reminder-core.mts'

type UpcomingShift = {
  id: string
  employee_user_id: string
  scheduled_start: Date | string
}

async function upcomingPublishedShifts(nowIso: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT id, employee_user_id,
            ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') AS scheduled_start
       FROM schedule_shifts
      WHERE status = 'published'
        AND ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') >= $1::timestamptz + interval '4 minutes'
        AND ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') <  $1::timestamptz + interval '19 minutes'
      ORDER BY scheduled_start, id`,
    [nowIso],
  )
  return result.rows as UpcomingShift[]
}

async function claimReminder(reminderKey: string, shiftId: string, scheduledStart: string, userId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO schedule_push_reminders (reminder_key, shift_id, scheduled_start, user_id, status, claimed_at)
     VALUES ($1, $2, $3::timestamptz, $4, 'claimed', now())
     ON CONFLICT (reminder_key) DO NOTHING
     RETURNING reminder_key`,
    [reminderKey, shiftId, scheduledStart, userId],
  )
  return Boolean(result.rows[0])
}

async function completeReminder(reminderKey: string) {
  const database = getDatabase()
  await database.pool.query(
    `UPDATE schedule_push_reminders
        SET status = 'processed', processed_at = now()
      WHERE reminder_key = $1 AND status = 'claimed'`,
    [reminderKey],
  )
}

async function releaseReminder(reminderKey: string) {
  const database = getDatabase()
  await database.pool.query(
    `DELETE FROM schedule_push_reminders WHERE reminder_key = $1 AND status = 'claimed'`,
    [reminderKey],
  )
}

export default async function scheduleStartReminders(_request: Request, _context: Context) {
  const nowIso = new Date().toISOString()
  let shifts: UpcomingShift[] = []
  try {
    shifts = await upcomingPublishedShifts(nowIso)
  } catch (error) {
    console.error('Schedule start reminder lookup failed', error)
    return
  }

  for (const shift of shifts) {
    const userId = String(shift.employee_user_id || '').trim()
    const scheduledStart = new Date(shift.scheduled_start).toISOString()
    if (!userId || !Number.isFinite(new Date(scheduledStart).getTime())) continue
    const reminderKey = scheduleReminderKey(String(shift.id), scheduledStart)

    let claimed = false
    try { claimed = await claimReminder(reminderKey, String(shift.id), scheduledStart, userId) } catch (error) {
      console.error('Schedule reminder claim failed', error)
      continue
    }
    if (!claimed) continue

    const result = await notifyShiftStartingSoon(userId)
    try {
      if (shouldReleaseReminderClaim(result)) await releaseReminder(reminderKey)
      else await completeReminder(reminderKey)
    } catch (error) {
      console.error('Schedule reminder finalize failed', error)
    }
  }
}

export const config: Config = { schedule: '*/15 * * * *' }
