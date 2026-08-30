import assert from 'node:assert/strict'
import fs from 'node:fs'
import { employeeManagementPolicy } from '../netlify/functions/_shared/employee-management-policy.mts'
import { createEmployeeAdminService } from '../netlify/functions/_shared/employee-admin-service.mts'

const decision = (input) => employeeManagementPolicy(input)
const allowed = (input) => decision(input).allowed

assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'admin' }), true)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'admin', targetUserId: 'admin-1', action: 'update-role', requestedRole: 'manager' }), true)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'update-role', requestedRole: 'employee' }), false)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'admin', targetUserId: 'admin-1', action: 'deactivate-account' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'manager' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'manager', targetUserId: 'manager-1', action: 'update-role', requestedRole: 'employee' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'admin' }), false)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'update-role', requestedRole: 'employee' }), false)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'deactivate-account' }), false)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'deactivate-account' }), false)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'deactivate-account' }), true)
assert.equal(allowed({ actorRole: 'manager', actorUserId: 'manager-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'manager' }), false)

assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-profile' }), true)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'update-profile' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-profile' }), false)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'deactivate-account' }), false)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'reactivate-account' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'reactivate-account' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'reactivate-account' }), false)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'reactivate-account' }), false)

assert.match(decision({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'deactivate-account' }).message, /Nur Hauptadmin/)
assert.match(decision({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-profile' }).message, /Nur Hauptadmin/)

const originalInactive = {
  userId: 'employee-reactivate-1',
  fullName: 'Existing Employee',
  role: 'employee',
  status: 'inactive',
  company: 'Habun',
  location: 'Site',
  employeeId: 'existing-employee-id',
  grantedAt: '2026-08-01T00:00:00.000Z',
  grantedBy: 'owner-1',
}
let storedEmployee = { ...originalInactive }
let scheduleSyncs = 0
let scheduleDeactivations = 0
const reactivationService = createEmployeeAdminService({
  async get(userId) {
    return userId === storedEmployee.userId ? { ...storedEmployee } : null
  },
  async list() {
    return [{ ...storedEmployee }]
  },
  async save(record) {
    storedEmployee = { ...record }
    return { ...storedEmployee }
  },
  async syncScheduleEmployee(record) {
    scheduleSyncs += 1
    assert.equal(record.userId, originalInactive.userId)
    assert.equal(record.status, 'active')
  },
  async deactivateScheduleEmployee() {
    scheduleDeactivations += 1
  },
})
const reactivated = await reactivationService.reactivate(
  { userId: 'owner-1', role: 'owner' },
  originalInactive.userId,
)
assert.equal(reactivated.userId, originalInactive.userId)
assert.equal(reactivated.employeeId, originalInactive.employeeId)
assert.equal(reactivated.fullName, originalInactive.fullName)
assert.equal(reactivated.status, 'active')
assert.equal(scheduleSyncs, 1)
assert.equal(scheduleDeactivations, 0)
assert.equal((await reactivationService.listEmployees({ userId: 'owner-1', role: 'owner' })).length, 1)

const registrations = fs.readFileSync(new URL('../netlify/functions/registrations.mts', import.meta.url), 'utf8')
const portalRole = fs.readFileSync(new URL('../netlify/functions/_shared/portal-role.mts', import.meta.url), 'utf8')
const scheduleDeactivation = fs.readFileSync(new URL('../netlify/functions/_shared/schedule-employee-management.mts', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../frontend/src/employee-role-management-auto.js', import.meta.url), 'utf8')

assert.match(registrations, /action === ['"]update-role['"]/)
assert.match(registrations, /action === ['"]deactivate-account['"]/)
assert.match(registrations, /update-profile/)
assert.match(registrations, /fullName/)
assert.match(registrations, /upsertScheduleEmployee/)
assert.match(registrations, /verifyRequestOrigin/)
assert.match(registrations, /deactivateScheduleEmployee/)
assert.match(portalRole, /status === ['"]inactive['"]/)
assert.match(scheduleDeactivation, /UPDATE schedule_employees/)
assert.match(scheduleDeactivation, /status = ['"]inactive['"]/)
assert.match(editor, /Rolle ändern/)
assert.match(editor, /Konto deaktivieren/)
assert.match(editor, /Daten bearbeiten/)
assert.match(editor, /update-profile/)
assert.match(editor, /Nur Hauptadmin darf Admin-Konten ändern/)

console.log('employee-role-management-policy-test: PASS')
