import type { Context } from '@netlify/functions'
import scheduleAssistant from '../schedule-assistant.mts'
import { bulkUpdateScheduleShifts } from './portal-admin-bulk-schedule.mts'
import {
  ScheduleAssistAdminError,
  scheduleAssistAdminService,
  type ScheduleAssistAdminActor,
} from './schedule-assist-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR: ScheduleAssistAdminActor = { userId: 'portal-admin-relay', role: 'owner' }

function httpFailureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409 || status === 410 || status === 422) return 'conflict' as const
  return 'rejected' as const
}

function publishResultStatus(data: Record<string, unknown>) {
  const results = Array.isArray(data.results) ? data.results : []
  if (!results.length) return { status: 'success' as const }
  const accepted = new Set(['published', 'duplicate'])
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
