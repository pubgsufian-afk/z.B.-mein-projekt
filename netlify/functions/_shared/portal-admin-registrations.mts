import {
  decideRegistration,
  listPendingRegistrations,
  type RegistrationAdminRole,
} from './registration-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR_ID = 'portal-admin-relay'

export function createRegistrationsPortalAdminHandler(actorRole: RegistrationAdminRole = 'owner'): PortalAdminHandler {
  return async (operation) => {
    try {
      if (operation.action === 'list') {
        const requests = await listPendingRegistrations()
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { requests, count: requests.length },
        }
      }

      if (operation.action === 'approve' || operation.action === 'reject') {
        const result = await decideRegistration({
          id: String(operation.input.id || ''),
          action: operation.action,
          role: String(operation.input.role || ''),
          actorId: RELAY_ACTOR_ID,
          actorRole,
        })
        if (!result.ok) {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: result.status === 404 ? 'not_found' : 'rejected',
            code: result.code,
          }
        }
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: result,
        }
      }

      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'INVALID_REGISTRATION_REQUEST',
        }
      }
      throw error
    }
  }
}
