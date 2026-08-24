import type {
  PortalAdminCommand,
  PortalAdminDomain,
  PortalAdminOperation,
} from './portal-admin-command-core.mts'
import { portalAdminActionAllowed } from './portal-admin-capabilities.mts'
import {
  portalAdminCounts,
  type PortalAdminItemResult,
  type PortalAdminResult,
} from './portal-admin-result.mts'

export type PortalAdminHandlerContext = {
  commandId: string
  reason: string
}

export type PortalAdminHandler = (
  operation: PortalAdminOperation,
  context: PortalAdminHandlerContext,
) => Promise<PortalAdminItemResult>

export function createPortalAdminRouter(
  handlers: Partial<Record<PortalAdminDomain, PortalAdminHandler>>,
) {
  return {
    async run(command: PortalAdminCommand): Promise<PortalAdminResult> {
      const operations: PortalAdminOperation[] = command.action === 'portal-batch'
        ? command.operations || []
        : [{
            itemId: command.commandId,
            domain: command.domain,
            action: command.action,
            input: command.input || {},
          }]
      const results: PortalAdminItemResult[] = []
      const context = { commandId: command.commandId, reason: command.reason || '' }

      for (const operation of operations) {
        const handler = handlers[operation.domain]
        if (!handler) {
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'DOMAIN_NOT_REGISTERED',
          })
          continue
        }
        if (!portalAdminActionAllowed(operation.domain, operation.action)) {
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'ACTION_NOT_REGISTERED',
          })
          continue
        }
        try {
          const result = await handler(operation, context)
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: result.status,
            ...(result.code ? { code: result.code } : {}),
            ...(result.data !== undefined ? { data: result.data } : {}),
          })
        } catch {
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'HANDLER_FAILED',
          })
        }
      }

      return {
        commandId: command.commandId,
        domain: command.domain,
        action: command.action,
        results,
        counts: portalAdminCounts(results),
      }
    },
  }
}
