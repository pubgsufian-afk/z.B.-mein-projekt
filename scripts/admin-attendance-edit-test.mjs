import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const apiPath = 'netlify/functions/attendance-edit.mts'
const uiPath = 'public/admin-attendance-editor.js'
const indexPath = 'public/index.html'

assert.ok(existsSync(apiPath), 'attendance-edit API must exist')
assert.ok(existsSync(uiPath), 'admin attendance editor UI must exist')

const apiSource = readFileSync(apiPath, 'utf8')
const uiSource = readFileSync(uiPath, 'utf8')
const indexSource = readFileSync(indexPath, 'utf8')

for (const role of ['owner', 'admin', 'manager']) {
  assert.match(apiSource, new RegExp(`['\"]${role}['\"]`), `API must include ${role} permission`)
  assert.match(uiSource, new RegExp(`['\"]${role}['\"]`), `UI must include ${role} permission`)
}

assert.match(apiSource, /verifyRequestOrigin/, 'write endpoint must verify request origin')
assert.match(apiSource, /attendance_audit_log/, 'direct edits must be audited')
assert.match(apiSource, /management-time-edit/, 'audit action must identify management edits')
assert.match(apiSource, /break-start/, 'pause correction must rebuild break-start')
assert.match(apiSource, /break-end/, 'pause correction must rebuild break-end')
assert.match(apiSource, /clock-out/, 'open sessions must support a managed clock-out')
assert.match(apiSource, /Keine Berechtigung/, 'API must reject unauthorized roles')
assert.match(uiSource, /\/api\/attendance-edit/, 'UI must save through the protected edit endpoint')
assert.match(uiSource, /Bearbeiten/, 'times rows must expose an edit action')
assert.match(uiSource, /pauseMinutes/, 'pause minutes must be editable')
assert.match(indexSource, /admin-attendance-editor\.js/, 'production index must load the attendance editor')

console.log('Admin/manager attendance editing contract verified.')
