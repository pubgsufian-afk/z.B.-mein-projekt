import type { Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import scheduleAssistant from '../schedule-assistant.mts'
import { bulkUpdateScheduleShifts } from './portal-admin-bulk-schedule.mts'
import {
  ScheduleAssistAdminError,
  scheduleAssistAdminService,
  type ScheduleAssistAdminActor,
} from './schedule-assist-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'


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

async function listScheduleDaysOff(input: Record<string, unknown>) {
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

async function batchSetScheduleDaysOff(input: Record<string, unknown>, commandId: string) {
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

const RELAY_ACTOR: ScheduleAssistAdminActor = { userId: 'portal-admin-relay', role: 'owner' }

function httpFailureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409 || status === 410 || status === 422) return 'conflict' as const
  return 'rejected' as const
}

function publishResultStatus(data: Record<string, unknown>) {
  const results = Array.isArray(data.results) ? data.results : []
  if (!results.length) return { status: 'success' as const }
  const accepted = new Set(['published', 'duplicate', 'already_satisfied'])
  const failed = results.filter((entry) => {
    const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    return !accepted.has(String(row.status || ''))
  }).length
  return failed
    ? { status: 'conflict' as const, code: 'PARTIAL_ASSISTANT_RESULT' }
    : { status: 'success' as const }
}

export function createSchedulePortalAdminHandler(context: Context): PortalAdminHandler {
  return async (operation, commandContext) => {
    if (operation.action === 'list-days-off') {
      const result = await listScheduleDaysOff(operation.input)
      return { itemId: operation.itemId, domain: operation.domain, action: operation.action, ...result }
    }
    if (operation.action === 'batch-set-days-off') {
      const result = await batchSetScheduleDaysOff(operation.input, commandContext.commandId)
      return { itemId: operation.itemId, domain: operation.domain, action: operation.action, ...result }
    }
    if (operation.action === 'bulk-update-shifts') {
      const data = await bulkUpdateScheduleShifts(operation.input, commandContext.commandId)
      const results = Array.isArray(data.results) ? data.results : []
      const failed = results.filter((entry) => {
        const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        return String(row.status || '') !== 'success'
      }).length
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: failed ? 'conflict' : 'success',
        ...(failed ? { code: 'PARTIAL_BULK_RESULT' } : {}),
        data,
      }
    }

    const assist = scheduleAssistAdminService()
    try {
      if (operation.action === 'list-templates') {
        const templates = await assist.listTemplates()
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { templates, count: templates.length } }
      }
      if (operation.action === 'suggestions') {
        const suggestions = await assist.suggestions(operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { suggestions } }
      }
      if (operation.action === 'review-week') {
        const data = await assist.reviewWeek(operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'save-template') {
        const template = await assist.saveTemplate(RELAY_ACTOR, operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { template } }
      }
      if (operation.action === 'delete-template') {
        if (operation.input.confirm !== true) {
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED' }
        }
        const data = await assist.deleteTemplate(operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
    } catch (error) {
      if (error instanceof ScheduleAssistAdminError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: httpFailureStatus(error.status),
          code: error.code,
        }
      }
      throw error
    }

    const token = String(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || '').trim()
    if (!token) {
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ASSISTANT_NOT_CONFIGURED',
      }
    }

    const reason = String(operation.input.reason || commandContext.reason || '').trim()
    const body = {
      ...operation.input,
      ...(reason ? { reason } : {}),
      action: operation.action,
      requestId: `${commandContext.commandId}:${operation.itemId}`,
    }
    const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }), context)
    const data = await response.json().catch(() => ({})) as Record<string, unknown>

    if (!response.ok) {
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: httpFailureStatus(response.status),
        code: `ASSISTANT_HTTP_${response.status}`,
        data,
      }
    }

    const resultStatus = operation.action === 'publish-shifts'
      ? publishResultStatus(data)
      : { status: 'success' as const }
    return {
      itemId: operation.itemId,
      domain: operation.domain,
      action: operation.action,
      ...resultStatus,
      data,
    }
  }
}
