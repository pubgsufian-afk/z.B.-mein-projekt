import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sessionSource = await readFile('netlify/functions/session.mts', 'utf8')
const appSource = await readFile('frontend/src/App.jsx', 'utf8')
const scheduleSource = await readFile('netlify/functions/schedule-v2-neon.mts', 'utf8')
const browserSource = await readFile('tests/e2e/unified-portal.spec.mjs', 'utf8')

assert.ok(sessionSource.includes('userId: data.userId || data.id'))
assert.ok(scheduleSource.includes('employeeUserId: current.userId'))
assert.ok(scheduleSource.includes('publishedOnly: true'))
assert.ok(appSource.includes('const visibleEntries = entries'))
assert.ok(!appSource.includes('const employeeSessionUserId = session.userId || session.id'))
assert.ok(browserSource.includes("role === 'employee'"))
assert.ok(browserSource.includes("{ id: 'employee-anna'"))

console.log('Employee schedule visibility tests passed')
