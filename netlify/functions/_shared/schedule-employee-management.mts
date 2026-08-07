import { getDatabase } from '@netlify/database'

export async function deactivateScheduleEmployee(userId: string) {
  const id = String(userId || '').trim()
  if (!id) return false
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE schedule_employees
        SET status = 'inactive', synced_at = now()
      WHERE user_id = $1
      RETURNING user_id`,
    [id],
  )
  return Boolean(result.rows[0])
}
