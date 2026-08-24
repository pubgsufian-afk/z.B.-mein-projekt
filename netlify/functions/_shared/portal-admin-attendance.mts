import type { Context } from '@netlify/functions'
import attendanceAssistant from '../attendance-assistant.mts'
import {
  AttendanceMaintenanceAdminError,
  attendanceMaintenanceAdminService,
  type AttendanceMaintenanceAdminActor,
} from './attendance-maintenance-admin-service.mts'
import { TimesheetAdminError, timesheetAdminService } from './timesheet-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const ATTENDANCE_ACTIONS = new Map([
  ['list', 'list-attendance'],
  ['find-duplicates', 'find-attendance-duplicates'],
  ['update-session', 'update-attendance-session'],
  ['bulk-update-sessions', 'bulk-update-attendance-sessions'],
  ['create-session', 'create-attendance-session'],
  ['delete-events', 'delete-attendance-events'],
])

const RELAY_ACTOR: AttendanceMaintenanceAdminActor = {
  userId: 'portal-admin-relay',
  email: 'portal-admin-relay@internal.invalid',
  role: 'owner',
}

function httpFailureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409 || status === 410 || status === 422) return 'conflict' as const
  return 'rejected' as const
}

export function createAttendancePortalAdminHandler(context: Context): PortalAdminHandler {
  return async (operation, commandContext) => {
    const reason = String(operation.input.reason || commandContext.reason || '').trim()
    const timesheets = timesheetAdminService()
    try {
      if (operation.action === 'timesheet-list') {
        const data = await timesheets.list(RELAY_ACTOR, operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'timesheet-manual-create') {
        const entry = await timesheets.createManual(RELAY_ACTOR, { ...operation.input, ...(reason ? { reason } : {}) })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
      if (operation.action === 'timesheet-manual-update') {
        const entry = await timesheets.updateManual(RELAY_ACTOR, { ...operation.input, ...(reason ? { reason } : {}) })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
      if (operation.action === 'timesheet-manual-delete') {
        if (operation.input.confirm !== true) {
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED' }
        }
        const data = await timesheets.deleteEntry(RELAY_ACTOR, { ...operation.input, ...(reason ? { reason } : {}) })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'timesheet-restore-schedule') {
        const entry = await timesheets.restoreSchedule(RELAY_ACTOR, { ...operation.input, ...(reason ? { reason } : {}) })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
    } catch (error) {
      if (error instanceof TimesheetAdminError) {
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

    const maintenance = attendanceMaintenanceAdminService()
    try {
      if (operation.action === 'list-corrections') {
        const corrections = await maintenance.listCorrections()
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { corrections, count: corrections.length },
        }
      }
      if (operation.action === 'decide-correction') {
        const data = await maintenance.decideCorrection(RELAY_ACTOR, {
          ...operation.input,
          ...(reason ? { reason } : {}),
        })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'retention-dry-run') {
        const data = await maintenance.retention(RELAY_ACTOR, false)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'retention-apply') {
        if (operation.input.confirm !== true) {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
          }
        }
        const data = await maintenance.retention(RELAY_ACTOR, true)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
    } catch (error) {
      if (error instanceof AttendanceMaintenanceAdminError) {
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
