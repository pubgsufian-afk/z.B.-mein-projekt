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
  pause_minutes_adjustment: number | null
}

export function buildReportEventQuery(from: string, to: string, userIds: string[]) {
  const selected = userIds.map(String).map((value) => value.trim()).filter(Boolean)
  const placeholders = selected.map((_, index) => `$${index + 3}`).join(', ')
  const employeeClause = selected.length ? ` AND e.user_id IN (${placeholders})` : ''
  return {
    text: `SELECT e.id, e.user_id, e.schedule_id, e.action, e.client_occurred_at, e.event_date, e.object_id, e.location_status, e.offline_captured,
                  a.pause_minutes AS pause_minutes_adjustment
             FROM attendance_events e
             LEFT JOIN LATERAL (
               SELECT adjustment.pause_minutes
                 FROM attendance_adjustments adjustment
                WHERE adjustment.event_id = e.id
                ORDER BY adjustment.occurred_at DESC, adjustment.id DESC
                LIMIT 1
             ) a ON true
            WHERE e.event_date BETWEEN $1::date AND $2::date${employeeClause}
            ORDER BY e.user_id, e.event_date, e.client_occurred_at`,
    params: [from, to, ...selected],
  }
}

export async function loadReportEvents(from: string, to: string, userIds: string[]) {
  const database = getDatabase()
  const query = buildReportEventQuery(from, to, userIds)
  const result = await database.pool.query(query.text, query.params)
  return result.rows as ReportEventRow[]
}
