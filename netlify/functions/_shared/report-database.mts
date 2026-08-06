import { getDatabase } from '@netlify/database'

export type ReportEventRow = {
  id: string
  user_id: string
  schedule_id: string | null
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  object_id: string | null
  location_status: string
  offline_captured: boolean
}

export function buildReportEventQuery(from: string, to: string, userIds: string[]) {
  const selected = userIds.map(String).map((value) => value.trim()).filter(Boolean)
  const placeholders = selected.map((_, index) => `$${index + 3}`).join(', ')
  const employeeClause = selected.length ? ` AND user_id IN (${placeholders})` : ''
  return {
    text: `SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
             FROM attendance_events
            WHERE event_date BETWEEN $1::date AND $2::date${employeeClause}
            ORDER BY user_id, event_date, client_occurred_at`,
    params: [from, to, ...selected],
  }
}

export async function loadReportEvents(from: string, to: string, userIds: string[]) {
  const database = getDatabase()
  const query = buildReportEventQuery(from, to, userIds)
  const result = await database.pool.query(query.text, query.params)
  return result.rows as ReportEventRow[]
}
