import {
  TimesheetAdminError,
  timesheetAdminService,
  type TimesheetAdminActor,
} from './timesheet-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR: TimesheetAdminActor = { userId: 'portal-admin-relay', role: 'owner' }

function failureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409 || status === 410 || status === 422) return 'conflict' as const
  return 'rejected' as const
}

export function createTimesheetsPortalAdminHandler(): PortalAdminHandler {
  return async (operation, commandContext) => {
    const service = timesheetAdminService()
    const reason = String(operation.input.reason || commandContext.reason || '').trim()
    const input = { ...operation.input, ...(reason ? { reason } : {}) }
    try {
      if (operation.action === 'list') {
        const data = await service.list(RELAY_ACTOR, input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'manual-create') {
        const entry = await service.createManual(RELAY_ACTOR, input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
      if (operation.action === 'manual-update') {
        const entry = await service.updateManual(RELAY_ACTOR, input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
      if (operation.action === 'manual-delete') {
        if (operation.input.confirm !== true) {
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED' }
        }
        const data = await service.deleteEntry(RELAY_ACTOR, input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'restore-schedule') {
        const entry = await service.restoreSchedule(RELAY_ACTOR, input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { entry } }
      }
      return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'ACTION_NOT_MAPPED' }
    } catch (error) {
      if (error instanceof TimesheetAdminError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: failureStatus(error.status),
          code: error.code,
        }
      }
      throw error
    }
  }
}
