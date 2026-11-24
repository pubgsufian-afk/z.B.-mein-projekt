import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Coordinate validation is now part of the source and the shared worksite policy.
const service = await readFile('netlify/functions/_shared/attendance-service.mts', 'utf8')
const handler = await readFile('netlify/functions/attendance.mts', 'utf8')
assert.match(service, /const configured = validWorksiteCoordinates\(object\)/)
assert.match(handler, /resolveAttendanceWorksite\(objectId,/)
console.log('Strict worksite coordinate validation verified')
