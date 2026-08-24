import type { Context } from '@netlify/functions'
import attendanceAssistant from '../attendance-assistant.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const ATTENDANCE_ACTIONS = new Map([
  ['list', 'list-attendance'],
  ['find-duplicates', 'find-attendance-duplicates'],
  ['update-session', 'update-attendance-session'],
  ['delete-events', 'delete-attendance-events'],
])

function httpFailureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409) return 'conflict' as const
  return 'rejected' as const
}

export function createAttendancePortalAdminHandler(context: Context): PortalAdminHandler {
  return async (operation, commandContext) => {
    const assistantAction = ATTENDANCE_ACTIONS.get(operation.action)
    if (!assistantAction) {
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
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
      action: assistantAction,
      requestId: `${commandContext.commandId}:${operation.itemId}`,
    }
    const response = await attendanceAssistant(new Request('https://internal.invalid/api/attendance-assistant', {
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

    return {
      itemId: operation.itemId,
      domain: operation.domain,
      action: operation.action,
      status: 'success',
      data,
    }
  }
}
