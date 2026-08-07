import assert from 'node:assert/strict'
import fs from 'node:fs'

const service = fs.readFileSync('netlify/functions/_shared/attendance-service.mts', 'utf8')
const attendance = fs.readFileSync('netlify/functions/attendance.mts', 'utf8')

assert.match(service, /current\.role === 'employee' \? current\.userId : normalizedText\(filters\.userId\)/)
assert.doesNotMatch(attendance, /resource === 'history'[\s\S]*?actor\.role === 'employee'[\s\S]*?FORBIDDEN/)
assert.match(attendance, /resource === 'history'[\s\S]*?service\.getHistory/)

console.log('timesheet self history contract passed')
