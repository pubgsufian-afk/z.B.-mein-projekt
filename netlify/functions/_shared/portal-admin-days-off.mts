import { getDatabase } from '@netlify/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function validDay(value: unknown): value is string {
  const day = String(value || '').trim()
  if (!ISO_DATE.test(day)) return false
  const parsed = new Date(day + 'T12:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}
function dateOnly(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
}

export async function listScheduleDaysOff(input: Record<string, unknown>) {
  const from = String(input.from || '')
  const to = String(input.to || '')
  if (!validDay(from) || !validDay(to) || to < from
    || (Date.parse(to) - Date.parse(from)) / 86400000 > 62) {
    return { status: 'rejected' as const, code: 'INVALID_DATE_RANGE' }
  }
  const db = getDatabase()
  const result = await db.pool.query(
    'SELECT employee_user_id, employee_name, day_off_date, source, request_id'
      + ' FROM schedule_days_off WHERE day_off_date BETWEEN $1::date AND $2::date'
      + ' ORDER BY day_off_date, employee_name LIMIT 500',
    [from, to],
  )
  const daysOff = result.rows.map((row) => ({
    employeeUserId: String(row.employee_user_id),
    employeeName: String(row.employee_name),
    date: dateOnly(row.day_off_date),
    source: String(row.source),
    requestId: row.request_id ? String(row.request_id) : null,
  }))
  return { status: 'success' as const, data: { daysOff, count: daysOff.length } }
}

export async function batchSetScheduleDaysOff(input: Record<string, unknown>, commandId: string) {
  const days = Array.isArray(input.days) ? input.days : []
  if (!days.length || days.length > 100) {
    return { status: 'rejected' as const, code: 'INVALID_DAY_OFF_BATCH' }
  }
  const db = getDatabase()
  const results: Array<Record<string, unknown>> = []
  for (let i = 0; i < days.length; i++) {
    const raw = days[i]
    const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const userId = String(row.employeeUserId || '').trim()
    const date = String(row.date || '').trim()
    const itemId = String(row.itemId || String(i)).slice(0, 100)
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !validDay(date)) {
      results.push({ itemId, status: 'rejected', code: 'INVALID_DAY_OFF_INPUT' })
      continue
    }
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const registered = await client.query(
        'SELECT employee_name FROM schedule_shifts WHERE employee_user_id=$1'
        + ' ORDER BY shift_date DESC, updated_at DESC LIMIT 1',
        [userId],
      )
      if (!registered.rows.length) {
        await client.query('ROLLBACK')
        results.push({ itemId, status: 'not_found', code: 'EMPLOYEE_NOT_FOUND' })
        continue
      }
      const employeeName = String(registered.rows[0].employee_name)
      const existing = await client.query(
        'SELECT employee_user_id FROM schedule_days_off WHERE employee_user_id=$1 AND day_off_date=$2::date',
        [userId, date],
      )
      if (existing.rows.length) {
        await client.query('ROLLBACK')
        results.push({ itemId, status: 'success', data: { changed: false, date, employeeName } })
        continue
      }
      await client.query(
        "INSERT INTO schedule_days_off (employee_user_id, day_off_date, employee_name, source, created_by)"
        + " VALUES ($1,$2::date,$3,'manual',$4)",
        [userId, date, employeeName, 'portal-admin-relay'],
      )
      await client.query(
        'INSERT INTO schedule_audit_log (id, occurred_at, actor_id, actor_type, action, shift_id, details)'
        + ' VALUES ($1,now(),$2,$3,$4,NULL,$5::jsonb)',
        [
          crypto.randomUUID(), 'portal-admin-relay', 'chatgpt', 'day-off-set',
          JSON.stringify({ commandId, itemId, employeeUserId: userId, employeeName, date, source: 'manual' }),
        ],
      )
      await client.query('COMMIT')
      results.push({ itemId, status: 'success', data: { changed: true, date, employeeName } })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = String((error as Error)?.message || '')
      const code = String((error as { code?: unknown })?.code || '')
      results.push({
        itemId,
        status: message.includes('HABUN_SHIFT_CONFLICT') ? 'conflict' : 'rejected',
        code: message.includes('HABUN_SHIFT_CONFLICT') ? 'SHIFT_CONFLICT' : code === '23505' ? 'DUPLICATE_DAY' : 'DAY_OFF_SAVE_FAILED',
      })
    } finally {
      client.release()
    }
  }
  return {
    status: results.every((row) => row.status === 'success') ? 'success' as const : 'conflict' as const,
    data: {
      results,
      succeededCount: results.filter((row) => row.status === 'success').length,
      rejectedCount: results.filter((row) => row.status !== 'success').length,
    },
  }
}
