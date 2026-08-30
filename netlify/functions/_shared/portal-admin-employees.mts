import {
  EmployeeAdminError,
  employeeAdminService,
  type EmployeeAdminActor,
  type EmployeeAdminRecord,
} from './employee-admin-service.mts'
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
