import {
  WorksiteAdminError,
  worksiteAdminService,
  type WorksiteAdminActor,
} from './worksite-admin-service.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR: WorksiteAdminActor = { userId: 'portal-admin-relay', role: 'owner' }

function text(value: unknown, max = 2000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function failureStatus(error: WorksiteAdminError) {
  if (error.status === 404) return 'not_found' as const
  if (error.status === 409 || error.status === 422) return 'conflict' as const
  return 'rejected' as const
}

export function createWorksitePortalAdminHandler(): PortalAdminHandler {
  return async (operation) => {
    const service = worksiteAdminService()
    try {
      if (operation.action === 'list') {
        const objects = await service.listWorksites(RELAY_ACTOR)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { objects, count: objects.length } }
      }
      if (operation.action === 'get') {
        const object = await service.getWorksite(RELAY_ACTOR, text(operation.input.id, 300))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { object } }
      }
      if (operation.action === 'save') {
        const data = await service.saveWorksite(RELAY_ACTOR, operation.input)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'resolve-map') {
        const data = await service.resolveGoogleMapsWorksite(RELAY_ACTOR, text(operation.input.url, 2000))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'delete') {
        if (operation.input.confirm !== true) {
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED' }
        }
        const data = await service.deleteWorksite(RELAY_ACTOR, text(operation.input.id, 300))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'ACTION_NOT_MAPPED' }
    } catch (error) {
      if (error instanceof WorksiteAdminError) {
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: failureStatus(error), code: error.code }
      }
      throw error
    }
  }
}
