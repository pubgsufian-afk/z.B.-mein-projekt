import { getStore } from '@netlify/blobs'
import { employeeManagementPolicy, type EmployeeManagementAction } from './employee-management-policy.mts'
import { deactivateScheduleEmployee } from './schedule-employee-management.mts'
import { upsertScheduleEmployee, type ScheduleEmployee } from './schedule-neon-repository.mts'

export type EmployeeAdminActor = { userId: string; role: 'owner' | 'admin' }
export type EmployeeAdminRecord = {
  userId: string
  fullName: string
  role: 'owner' | 'admin' | 'manager' | 'employee'
  status: string
  company: string
  location: string
  employeeId?: string
  grantedAt?: string
  grantedBy?: string
}
export type EmployeeAdminProfilePatch = { fullName: string; company: string; location: string }
export type EmployeeAdminRepository = {
  get(userId: string): Promise<EmployeeAdminRecord | null>
  list(): Promise<EmployeeAdminRecord[]>
  save(record: EmployeeAdminRecord): Promise<EmployeeAdminRecord>
  syncScheduleEmployee(record: EmployeeAdminRecord): Promise<void>
  deactivateScheduleEmployee(userId: string): Promise<void>
}

export class EmployeeAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'EMPLOYEE_ADMIN_ERROR') {
    super(message)
    this.name = 'EmployeeAdminError'
    this.status = status
    this.code = code
  }
}

function text(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function mapRecord(value: Record<string, unknown>): EmployeeAdminRecord | null {
  const userId = text(value.userId, 300)
  if (!userId) return null
  const rawRole = text(value.role, 50)
  const role: EmployeeAdminRecord['role'] = ['owner', 'admin', 'manager', 'employee'].includes(rawRole)
    ? rawRole as EmployeeAdminRecord['role']
    : 'employee'
  return {
    userId,
    fullName: text(value.fullName, 300),
    role,
    status: text(value.status, 50) || 'active',
    company: text(value.company, 300),
    location: text(value.location, 300),
    employeeId: text(value.employeeId, 200) || undefined,
    grantedAt: text(value.grantedAt, 100) || undefined,
    grantedBy: text(value.grantedBy, 300) || undefined,
  }
}

function defaultRepository(): EmployeeAdminRepository {
  const store = getStore({ name: 'portal-access', consistency: 'strong' })
  return {
    async get(userId) {
      const row = await store.get(`access/${userId}`, { type: 'json' }) as Record<string, unknown> | null
      return row ? mapRecord(row) : null
    },
    async list() {
      const listed = await store.list({ prefix: 'access/' })
      const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<Record<string, unknown> | null>))
      return rows.flatMap((row) => {
        const mapped = row ? mapRecord(row) : null
        return mapped ? [mapped] : []
      })
    },
    async save(record) {
      await store.setJSON(`access/${record.userId}`, record)
      return record
    },
    async syncScheduleEmployee(record) {
      await upsertScheduleEmployee({
        userId: record.userId,
        fullName: record.fullName,
        role: record.role as ScheduleEmployee['role'],
        status: record.status === 'inactive' ? 'inactive' : 'active',
        location: record.location,
      })
    },
    async deactivateScheduleEmployee(userId) {
      await deactivateScheduleEmployee(userId)
    },
  }
}

function assertPolicy(actor: EmployeeAdminActor, target: EmployeeAdminRecord, action: EmployeeManagementAction, requestedRole?: string) {
  const result = employeeManagementPolicy({
    actorRole: actor.role,
    actorUserId: actor.userId,
    targetRole: target.role,
    targetUserId: target.userId,
    action,
    requestedRole,
  })
  if (!result.allowed) throw new EmployeeAdminError(result.message, result.status, 'EMPLOYEE_POLICY_DENIED')
}

export function createEmployeeAdminService(repository: EmployeeAdminRepository = defaultRepository()) {
  async function target(userId: string) {
    const id = text(userId, 300)
    if (!id) throw new EmployeeAdminError('Mitarbeiter ist erforderlich.', 400, 'EMPLOYEE_REQUIRED')
    const record = await repository.get(id)
    if (!record || record.status !== 'active') throw new EmployeeAdminError('Aktiver Mitarbeiter wurde nicht gefunden.', 404, 'EMPLOYEE_NOT_FOUND')
    return record
  }

  return {
    async getEmployee(_actor: EmployeeAdminActor, userId: string) {
      return target(userId)
    },
    async listEmployees(_actor: EmployeeAdminActor, filters: { status?: string; name?: string } = {}) {
      let rows = await repository.list()
      const status = text(filters.status, 50)
      const name = text(filters.name, 300).toLocaleLowerCase('de-DE').replace(/\s+/g, ' ')
      if (status) rows = rows.filter((row) => row.status === status)
      if (name) rows = rows.filter((row) => row.fullName.toLocaleLowerCase('de-DE').replace(/\s+/g, ' ').includes(name))
      return rows.sort((a, b) => a.fullName.localeCompare(b.fullName, 'de'))
    },
    async updateProfile(actor: EmployeeAdminActor, userId: string, patch: EmployeeAdminProfilePatch) {
      const current = await target(userId)
      assertPolicy(actor, current, 'update-profile')
      const fullName = text(patch.fullName, 300)
      if (!fullName) throw new EmployeeAdminError('Der Name darf nicht leer sein.', 400, 'NAME_REQUIRED')
      const updated: EmployeeAdminRecord = {
        ...current,
        fullName,
        company: text(patch.company, 300),
        location: text(patch.location, 300),
        grantedAt: new Date().toISOString(),
        grantedBy: actor.userId,
      }
      await repository.save(updated)
      await repository.syncScheduleEmployee(updated)
      return updated
    },
    async updateRole(actor: EmployeeAdminActor, userId: string, requestedRole: string) {
      const current = await target(userId)
      const role = text(requestedRole, 50)
      if (!['employee', 'manager', 'admin'].includes(role)) throw new EmployeeAdminError('Ungültige Zielrolle.', 400, 'INVALID_ROLE')
      assertPolicy(actor, current, 'update-role', role)
      const updated: EmployeeAdminRecord = {
        ...current,
        role: role as EmployeeAdminRecord['role'],
        status: 'active',
        grantedAt: new Date().toISOString(),
        grantedBy: actor.userId,
      }
      await repository.save(updated)
      await repository.syncScheduleEmployee(updated)
      return updated
    },
    async deactivate(actor: EmployeeAdminActor, userId: string) {
      const current = await target(userId)
      assertPolicy(actor, current, 'deactivate-account')
      const updated: EmployeeAdminRecord = {
        ...current,
        status: 'inactive',
        grantedAt: new Date().toISOString(),
        grantedBy: actor.userId,
      }
      await repository.save(updated)
      await repository.deactivateScheduleEmployee(updated.userId)
      return updated
    },
  }
}

export function employeeAdminService() {
  return createEmployeeAdminService()
}
