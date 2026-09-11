import {
  EmployeeAdminError,
  employeeAdminService,
  type EmployeeAdminActor,
  type EmployeeAdminRecord,
} from './employee-admin-service.mts'
import {
  deleteEmployeeAlias,
  listEmployeeAliases,
  saveEmployeeAlias,
} from './employee-alias-service.mts'
import { inspectPortalHealth } from './portal-admin-health.mts'
import { normalizeAssistantName } from './schedule-assistant-core.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR: EmployeeAdminActor = { userId: 'portal-admin-relay', role: 'owner' }

function text(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function safeEmployee(employee: EmployeeAdminRecord) {
  return {
    userId: employee.userId,
    fullName: employee.fullName,
    role: employee.role,
    status: employee.status,
    company: employee.company,
    location: employee.location,
    employeeId: employee.employeeId || '',
  }
}

function statusFromError(error: EmployeeAdminError) {
  if (error.status === 404) return 'not_found' as const
  if (error.status === 409) return 'conflict' as const
  return 'rejected' as const
}

function aliasError(error: unknown) {
  const code = text((error as { code?: unknown })?.code, 100) || 'ALIAS_ERROR'
  return {
    status: code === 'ALIAS_CONFLICT' ? 'conflict' as const : 'rejected' as const,
    code,
  }
}

export function createEmployeePortalAdminHandler(): PortalAdminHandler {
  return async (operation) => {
    const service = employeeAdminService()
    try {
      if (operation.action === 'get') {
        const employee = await service.getEmployee(RELAY_ACTOR, text(operation.input.userId, 300))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: safeEmployee(employee) }
      }
      if (operation.action === 'list') {
        const employees = await service.listEmployees(RELAY_ACTOR, {
          status: text(operation.input.status, 50),
          name: text(operation.input.name, 300),
        })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { employees: employees.map(safeEmployee), count: employees.length } }
      }
      if (operation.action === 'portal-health') {
        try {
          const data = await inspectPortalHealth(operation.input)
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
        } catch (error) {
          if (error instanceof TypeError || error instanceof RangeError) {
            return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'INVALID_HEALTH_RANGE' }
          }
          throw error
        }
      }
      if (operation.action === 'list-aliases') {
        const [aliases, employees] = await Promise.all([
          listEmployeeAliases(),
          service.listEmployees(RELAY_ACTOR, { status: 'active' }),
        ])
        const byUserId = new Map(employees.map((employee) => [employee.userId, employee]))
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: {
            aliases: aliases.map((alias) => ({
              alias: alias.alias,
              userId: alias.userId,
              employeeName: byUserId.get(alias.userId)?.fullName || '',
              staleTarget: !byUserId.has(alias.userId),
              updatedAt: alias.updatedAt,
            })),
            count: aliases.length,
          },
        }
      }
      if (operation.action === 'save-alias') {
        const userId = text(operation.input.userId, 300)
        const alias = text(operation.input.alias, 300)
        const employee = await service.getEmployee(RELAY_ACTOR, userId)
        const employees = await service.listEmployees(RELAY_ACTOR, { status: 'active' })
        const normalizedAlias = normalizeAssistantName(alias)
        const canonicalCollision = employees.find((candidate) => (
          candidate.userId !== userId && normalizeAssistantName(candidate.fullName) === normalizedAlias
        ))
        if (canonicalCollision) {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'conflict',
            code: 'ALIAS_CANONICAL_NAME_CONFLICT',
            data: { employeeName: canonicalCollision.fullName },
          }
        }
        try {
          const saved = await saveEmployeeAlias({ alias, userId: employee.userId, actorId: RELAY_ACTOR.userId })
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'success',
            data: { alias: saved.alias, userId: employee.userId, employeeName: employee.fullName, updatedAt: saved.updatedAt },
          }
        } catch (error) {
          const result = aliasError(error)
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, ...result }
        }
      }
      if (operation.action === 'delete-alias') {
        try {
          const data = await deleteEmployeeAlias({ alias: operation.input.alias, actorId: RELAY_ACTOR.userId })
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
        } catch (error) {
          const result = aliasError(error)
          return { itemId: operation.itemId, domain: operation.domain, action: operation.action, ...result }
        }
      }
      if (operation.action === 'update-profile') {
        const employee = await service.updateProfile(RELAY_ACTOR, text(operation.input.userId, 300), {
          fullName: text(operation.input.fullName, 300),
          company: text(operation.input.company, 300),
          location: text(operation.input.location, 300),
        })
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: safeEmployee(employee) }
      }
      if (operation.action === 'update-role') {
        const employee = await service.updateRole(RELAY_ACTOR, text(operation.input.userId, 300), text(operation.input.role, 50))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: safeEmployee(employee) }
      }
      if (operation.action === 'deactivate-account') {
        const employee = await service.deactivate(RELAY_ACTOR, text(operation.input.userId, 300))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: safeEmployee(employee) }
      }
      if (operation.action === 'reactivate-account') {
        const employee = await service.reactivate(RELAY_ACTOR, text(operation.input.userId, 300))
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: safeEmployee(employee) }
      }
      return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'ACTION_NOT_MAPPED' }
    } catch (error) {
      if (error instanceof EmployeeAdminError) {
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: statusFromError(error), code: error.code }
      }
      throw error
    }
  }
}
