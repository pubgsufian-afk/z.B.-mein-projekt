import assert from 'node:assert/strict'
import fs from 'node:fs'
import { employeeManagementPolicy } from '../netlify/functions/_shared/employee-management-policy.mts'

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

assert.match(decision({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'deactivate-account' }).message, /Nur Hauptadmin/)

const registrations = fs.readFileSync(new URL('../netlify/functions/registrations.mts', import.meta.url), 'utf8')
const portalRole = fs.readFileSync(new URL('../netlify/functions/_shared/portal-role.mts', import.meta.url), 'utf8')
const scheduleDeactivation = fs.readFileSync(new URL('../netlify/functions/_shared/schedule-employee-management.mts', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../frontend/src/employee-role-management-auto.js', import.meta.url), 'utf8')

assert.match(registrations, /action === ['"]update-role['"]/)
assert.match(registrations, /action === ['"]deactivate-account['"]/)
assert.match(registrations, /verifyRequestOrigin/)
assert.match(registrations, /deactivateScheduleEmployee/)
assert.match(portalRole, /status === ['"]inactive['"]/)
assert.match(scheduleDeactivation, /UPDATE schedule_employees/)
assert.match(scheduleDeactivation, /status = ['"]inactive['"]/)
assert.match(editor, /Rolle ändern/)
assert.match(editor, /Konto deaktivieren/)
assert.match(editor, /Nur Hauptadmin darf Admin-Konten ändern/)

console.log('employee-role-management-policy-test: PASS')
