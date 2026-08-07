import assert from 'node:assert/strict'
import fs from 'node:fs'

const urlFor = (path) => new URL(`../${path}`, import.meta.url)
const read = (path) => fs.readFileSync(urlFor(path), 'utf8')

const editor = read('frontend/src/employee-role-management-auto.js')
const build = read('scripts/build-frontend.mjs')
const registrations = read('netlify/functions/registrations.mts')

assert.ok(build.includes("inject: ['frontend/src/employee-role-management-auto.js']"), 'role editor must be included in the production frontend bundle')
assert.ok(editor.includes("action: 'update-role'"), 'active employee role updates must use the registrations PATCH action')
assert.ok(editor.includes("label.textContent = 'Rolle'"), 'active employee cards must show the current role')
assert.ok(editor.includes("button.textContent = 'Rolle ändern'"), 'active employee cards must expose a clear role update action')
assert.ok(editor.includes("['manager', 'Einsatzleiter']"), 'role editor must offer Einsatzleiter')
assert.ok(editor.includes("['admin', 'Admin']"), 'Hauptadmin role editor must offer Admin')
assert.ok(editor.includes("actorRole === 'owner' || actorRole === 'admin'"), 'only Hauptadmin/Admin may edit active employee roles in the UI')
assert.ok(editor.includes("currentRole === 'owner'"), 'Hauptadmin card must be protected in the UI')

assert.ok(registrations.includes("payload?.action === 'update-role'"), 'registrations backend must route active employee role changes')
assert.ok(registrations.includes("new Set(['employee', 'manager', 'admin'])"), 'backend must allow only employee, manager and admin as assignable roles')
assert.ok(registrations.includes("role === 'admin' && access.current.role !== 'owner'"), 'only Hauptadmin may assign Admin')
assert.ok(registrations.includes("getStore({ name: 'portal-access', consistency: 'strong' })"), 'role changes must persist in the authoritative access store')
assert.ok(registrations.includes("target.role === 'owner'"), 'Hauptadmin role must be protected from modification')
assert.ok(registrations.includes("target.role === 'admin'"), 'normal Admin must not modify another Admin account')

console.log('employee-role-management-test: PASS')
