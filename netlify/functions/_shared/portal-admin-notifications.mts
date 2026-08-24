import { sendPortalPush } from './push-core.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

function clean(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

export function createNotificationsPortalAdminHandler(): PortalAdminHandler {
  return async (operation) => {
    if (operation.action !== 'send') {
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
    }
    try {
      const result = await sendPortalPush({
        actorRole: 'owner',
        targetUserId: clean(operation.input.targetUserId, 200) || undefined,
        title: clean(operation.input.title || 'Habun Mitarbeiterportal', 80),
        body: clean(operation.input.message ?? operation.input.body, 300),
        url: clean(operation.input.url || '/', 500) || '/',
      })
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'success',
        data: result,
      }
    } catch (error) {
      if (error instanceof TypeError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'INVALID_NOTIFICATION',
        }
      }
      throw error
    }
  }
}
