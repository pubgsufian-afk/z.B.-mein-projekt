import assert from 'node:assert/strict'
import fs from 'node:fs'

const urlFor = (path) => new URL(`../${path}`, import.meta.url)
const read = (path) => fs.readFileSync(urlFor(path), 'utf8')

const app = read('frontend/src/App.jsx')
const registrations = read('netlify/functions/registrations.mts')

assert.ok(app.includes('async function updateEmployeeRole'), 'active employee UI must provide a role update action')
assert.ok(app.includes("action: 'update-role'"), 'active employee role updates must use the registrations PATCH action')
assert.ok(app.includes('ROLE_LABELS[employee.role'), 'active employee cards must show the current role')
assert.ok(app.includes('Rolle ändern'), 'active employee cards must expose a clear role selector/action')
assert.ok(app.includes('<option value="manager">Einsatzleiter</option>'), 'role editor must offer Einsatzleiter')
assert.ok(app.includes('<option value="admin">Admin</option>'), 'role editor must offer Admin where permitted')

assert.ok(registrations.includes("action === 'update-role'"), 'registrations backend must handle active employee role changes')
assert.ok(registrations.includes("new Set(['employee', 'manager', 'admin'])"), 'backend must allow only employee, manager and admin as assignable roles')
assert.ok(registrations.includes("role === 'admin' && access.current.role !== 'owner'"), 'only Hauptadmin may assign Admin')
assert.ok(registrations.includes("getStore({ name: 'portal-access', consistency: 'strong' })"), 'role changes must persist in the authoritative access store')
assert.ok(registrations.includes("target.role === 'owner'"), 'Hauptadmin role must be protected from modification')

console.log('employee-role-management-test: PASS')
