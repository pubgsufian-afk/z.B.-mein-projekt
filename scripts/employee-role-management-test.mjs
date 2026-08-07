import assert from 'node:assert/strict'
import fs from 'node:fs'
import { employeeManagementPolicy } from '../netlify/functions/registrations.mts'

const allowed = (input) => employeeManagementPolicy(input).allowed

assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'admin' }), true, 'Hauptadmin may promote employee to Admin')
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'admin', targetUserId: 'admin-1', action: 'update-role', requestedRole: 'manager' }), true, 'Hauptadmin may demote Admin')
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'update-role', requestedRole: 'employee' }), false, 'Hauptadmin account must stay protected')
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'admin', targetUserId: 'admin-1', action: 'deactivate-account' }), true, 'Hauptadmin may deactivate Admin')

assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'manager' }), true, 'Admin may promote employee to Einsatzleiter')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'manager', targetUserId: 'manager-1', action: 'update-role', requestedRole: 'employee' }), true, 'Admin may demote Einsatzleiter to employee')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'admin' }), false, 'Admin may not assign Admin')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'update-role', requestedRole: 'employee' }), false, 'Admin may not change another Admin')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'admin', targetUserId: 'admin-2', action: 'deactivate-account' }), false, 'Admin may not deactivate another Admin')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'deactivate-account' }), false, 'Admin may not alter Hauptadmin')
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'deactivate-account' }), true, 'Admin may deactivate employee')
assert.equal(allowed({ actorRole: 'manager', actorUserId: 'manager-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-role', requestedRole: 'manager' }), false, 'Einsatzleiter may not manage roles')

const registrations = fs.readFileSync(new URL('../netlify/functions/registrations.mts', import.meta.url), 'utf8')
const portalRole = fs.readFileSync(new URL('../netlify/functions/_shared/portal-role.mts', import.meta.url), 'utf8')
const scheduleRepository = fs.readFileSync(new URL('../netlify/functions/_shared/schedule-neon-repository.mts', import.meta.url), 'utf8')
const editor = fs.readFileSync(new URL('../frontend/src/employee-role-management-auto.js', import.meta.url), 'utf8')

assert.match(registrations, /action === ['"]update-role['"]/, 'backend must support active role changes')
assert.match(registrations, /action === ['"]deactivate-account['"]/, 'backend must support portal account deactivation')
assert.match(registrations, /verifyRequestOrigin/, 'management writes must verify request origin')
assert.match(registrations, /portal-access/, 'portal-access must remain authoritative')
assert.match(registrations, /deactivateScheduleEmployee/, 'deactivation must sync to schedule directory')
assert.match(portalRole, /status === ['"]inactive['"]/, 'inactive access must block stale Identity-role fallback')
assert.match(scheduleRepository, /export async function deactivateScheduleEmployee/, 'schedule directory needs an explicit inactive update')
assert.match(editor, /Rolle ändern/, 'employee cards must expose role editing')
assert.match(editor, /Konto deaktivieren/, 'authorized employee cards must expose account deactivation')
assert.match(editor, /Nur Hauptadmin darf Admin-Konten ändern/, 'Admin protection must be visible in UI')

console.log('employee-role-management-test: PASS')
