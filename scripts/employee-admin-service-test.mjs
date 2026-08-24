import assert from 'node:assert/strict'
import { createEmployeeAdminService } from '../netlify/functions/_shared/employee-admin-service.mts'

const rows = new Map([
  ['owner-1', { userId: 'owner-1', fullName: 'Owner', role: 'owner', status: 'active', company: 'Habun', location: 'Zentrale' }],
  ['u1', { userId: 'u1', fullName: 'Mitarbeiter A', role: 'employee', status: 'active', company: 'Habun', location: 'Abbott' }],
])
const repository = {
  async get(userId) { return rows.get(userId) || null },
  async list() { return [...rows.values()] },
  async save(record) { rows.set(record.userId, record); return record },
  async syncScheduleEmployee() {},
  async deactivateScheduleEmployee() {},
}
const service = createEmployeeAdminService(repository)
const actor = { userId: 'portal-admin-relay', role: 'owner' }

const updated = await service.updateProfile(actor, 'u1', { fullName: 'Mitarbeiter Neu', company: 'Habun', location: 'Objekt 1' })
assert.equal(updated.fullName, 'Mitarbeiter Neu')
const promoted = await service.updateRole(actor, 'u1', 'manager')
assert.equal(promoted.role, 'manager')
await assert.rejects(() => service.deactivate(actor, 'owner-1'), /Hauptadmin/)
assert.equal((await service.getEmployee(actor, 'u1')).userId, 'u1')
assert.equal((await service.listEmployees(actor, { status: 'active' })).length, 2)

console.log('employee admin service tests passed')
