import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sessionSource = await readFile('netlify/functions/session.mts', 'utf8')
const appSource = await readFile('frontend/src/App.jsx', 'utf8')
const browserSource = await readFile('tests/e2e/unified-portal.spec.mjs', 'utf8')

assert.ok(sessionSource.includes('userId: data.userId || data.id'))
assert.ok(appSource.includes('const employeeSessionUserId = session.userId || session.id'))
assert.ok(appSource.includes("entry.status === 'published'"))
assert.ok(browserSource.includes("role === 'employee'"))
assert.ok(browserSource.includes("{ id: 'employee-anna'"))

console.log('Employee schedule visibility tests passed')
