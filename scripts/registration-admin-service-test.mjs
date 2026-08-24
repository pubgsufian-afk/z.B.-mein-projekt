import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const service = await readFile('netlify/functions/_shared/registration-admin-service.mts', 'utf8')
const adapter = await readFile('netlify/functions/_shared/portal-admin-registrations.mts', 'utf8')

for (const needle of [
  "getStore({ name: 'portal-registrations'",
  "getStore({ name: 'portal-access'",
  "status === 'pending'",
  "input.action === 'reject'",
  "action: 'approve' as const",
  'upsertScheduleEmployee',
  'Nur der Hauptadmin darf weitere Admins bestimmen.',
]) assert.ok(service.includes(needle), `missing ${needle}`)

for (const needle of ["operation.action === 'list'", "operation.action === 'approve'", "operation.action === 'reject'"]) {
  assert.ok(adapter.includes(needle), `missing adapter action ${needle}`)
}

assert.doesNotMatch(service, /list\(\{ prefix: 'access\/'/)
assert.doesNotMatch(adapter, /console\.log/)

console.log('registration admin service tests passed')
