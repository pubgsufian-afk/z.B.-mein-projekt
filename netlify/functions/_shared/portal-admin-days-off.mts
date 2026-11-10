import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { tryRecordPortalAdminChange } from './portal-private-audit-service.mts'

export const DAY_OFF_RELAY_ACTOR = { userId: 'portal-admin-relay', email: '', role: 'owner' } as const
const ISO = /^\d{4}-\d{2}-\d{2}$/
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DAYS = 62

function date(value: unknown) {
  const valueString = String(value || '').trim()
  if (!ISO.test(valueString)) return null
  const candidate = new Date(valueString + 'T12:00:00Z')
  return !Number.isNaN(candidate.getTime()) && candidate.toISOString().slice(0, 10) === valueString ? valueString : null
}
function rowDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}
async function resolveActiveEmployee(userId: string) {
  if (!USER_ID.test(userId)) return null
  const access = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get('access/' + userId, { type: 'json' }) as { status?: string; fullName?: string } | null
  if (access?.status && access.status !== 'active') return null
  if (access?.status === 'active' && String(access.fullName || '').trim())
    return { userId, fullName: String(access.fullName).trim() }
  const found = await getDatabase().pool.query(
    "SELECT full_name FROM schedule_employees WHERE user_id = $1 AND status = 'active'", [userId])
  const name = String(found.rows[0]?.full_name || '').trim()
  return name ? { userId, fullName: name } : null
}
export async function relayListDaysOff(input: Record<string, unknown>) {
  const from = date(input.from), to = date(input.to)
  if (!from || !to || from > to) throw new Error('INVALID_DATE_RANGE')
  const inclusiveDays = Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1
  if (inclusiveDays < 1 || inclusiveDays > MAX_DAYS) throw new Error('INVALID_DATE_RANGE')
  const rows = await getDatabase().pool.query(
    'SELECT employee_user_id, employee_name, day_off_date, source FROM schedule_days_off WHERE day_off_date BETWEEN $1::date AND $2::date ORDER BY day_off_date, lower(employee_name), employee_user_id LIMIT 500',
    [from, to])
  return {
    daysOff: rows.rows.map((row) => ({
      employeeUserId: String(row.employee_user_id),
      employeeName: String(row.employee_name),
      date: rowDate(row.day_off_date),
      source: String(row.source),
    })),
    count: rows.rows.length, truncated: rows.rows.length >= 500,
  }
}
export type RelayDayOffItemResult = {
  itemId: string
  status: 'success' | 'duplicate' | 'conflict' | 'rejected'
  code?: string
  data?: { employeeUserId: string; employeeName: string; date: string }
}
export async function relayBulkSetDaysOff(input: Record<string, unknown>, commandId: string): Promise<{ results: RelayDayOffItemResult[] }> {
  const days = Array.isArray(input.days) ? input.days : []
  if (!days.length || days.length > 100) throw new Error('INVALID_DAYS_COUNT')
  const results: RelayDayOffItemResult[] = []
  const encountered = new Set<string>()
  for (let index = 0; index < days.length; index += 1) {
    const raw = days[index] && typeof days[index] === 'object' && !Array.isArray(days[index])
      ? days[index] as Record<string, unknown> : {}
    const itemId = String(raw.itemId || index).slice(0, 120)
    const userId = String(raw.employeeUserId || '').trim()
    const day = date(raw.date)
    if (!day || !USER_ID.test(userId)) {
      results.push({ itemId, status: 'rejected', code: 'INVALID_EMPLOYEE_OR_DATE' }); continue
    }
    const key = userId + '|' + day
    if (encountered.has(key)) {
      results.push({ itemId, status: 'duplicate', code: 'DUPLICATE_IN_BATCH' }); continue
    }
    encountered.add(key)
    try {
      const employee = await resolveActiveEmployee(userId)
      if (!employee) {
        results.push({ itemId, status: 'rejected', code: 'EMPLOYEE_NOT_ACTIVE' }); continue
      }
      const inserted = await getDatabase().pool.query(
        "INSERT INTO schedule_days_off (employee_user_id, day_off_date, employee_name, source, created_by) VALUES ($1, $2::date, $3, 'manual', $4) ON CONFLICT (employee_user_id, day_off_date) DO NOTHING RETURNING employee_user_id",
        [userId, day, employee.fullName, DAY_OFF_RELAY_ACTOR.userId])
      if (!inserted.rowCount) {
        results.push({ itemId, status: 'duplicate', code: 'ALREADY_DAY_OFF' }); continue
      }
      await tryRecordPortalAdminChange({
        actor: DAY_OFF_RELAY_ACTOR, category: 'Dienstfrei',
        action: 'Dienstfrei eingetragen (PR #73)',
        entityId: userId + ':' + day, targetName: employee.fullName,
        summary: 'Dienstfrei eingetragen',
        after: { employeeUserId: userId, employeeName: employee.fullName, date: day, commandId },
      })
      results.push({ itemId, status: 'success',
        data: { employeeUserId: userId, employeeName: employee.fullName, date: day } })
    } catch (error) {
      const message = String((error as Error)?.message || '')
      if (message.includes('HABUN_SHIFT_CONFLICT'))
        results.push({ itemId, status: 'conflict', code: 'EXISTING_SHIFT' })
      else {
        results.push({ itemId, status: 'rejected', code: 'DAY_OFF_WRITE_FAILED' })
        console.error('PR #73 day off write failed', error)
      }
    }
  }
  return { results }
}
