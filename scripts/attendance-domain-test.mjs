import assert from 'node:assert/strict'
import {
  buildIdempotencyKey,
  calculateNetMinutes,
  classifyLocation,
  distanceMetersBetween,
  sanitizeAttendanceAuditPayload,
  validateAttendanceTransition,
} from '../netlify/functions/_shared/attendance-domain.mjs'

assert.deepEqual(classifyLocation(500, true, true, 500), {
  status: 'inside',
  configured: true,
  available: true,
  distanceMeters: 500,
  radiusMeters: 500,
  accuracyMeters: 0,
  accuracyToleranceMeters: 0,
  allowedDistanceMeters: 500,
})

assert.equal(classifyLocation(500.01, true, true, 500).status, 'outside')
assert.equal(classifyLocation(null, true, false, 500).status, 'unavailable')
assert.equal(classifyLocation(null, false, true, 500).status, 'unavailable')
assert.equal(distanceMetersBetween(52.375, 9.732, 52.375, 9.732), 0)
const oneLatitudeMillidegree = distanceMetersBetween(52.375, 9.732, 52.376, 9.732)
assert.ok(oneLatitudeMillidegree > 110 && oneLatitudeMillidegree < 112)

assert.deepEqual(validateAttendanceTransition([], 'clock-in'), { ok: true })
assert.deepEqual(validateAttendanceTransition([], 'clock-out'), {
  ok: false,
  code: 'CLOCK_OUT_WITHOUT_CLOCK_IN',
})
assert.deepEqual(validateAttendanceTransition([{ action: 'clock-in' }], 'clock-in'), {
  ok: false,
  code: 'CLOCK_IN_ALREADY_OPEN',
})
assert.deepEqual(validateAttendanceTransition([{ action: 'clock-in' }], 'clock-out'), { ok: true })
assert.deepEqual(
  validateAttendanceTransition([{ action: 'clock-in' }, { action: 'clock-out' }], 'clock-in'),
  { ok: true },
)

assert.equal(calculateNetMinutes('2026-08-06T08:00:00.000Z', '2026-08-06T17:00:00.000Z', 30), 510)
assert.throws(
  () => calculateNetMinutes('2026-08-06T08:00:00.000Z', '2026-08-06T08:30:00.000Z', 30),
  /Pause muss kürzer als die Bruttoarbeitszeit sein/,
)
assert.throws(
  () => calculateNetMinutes('2026-08-06T09:00:00.000Z', '2026-08-06T08:00:00.000Z', 0),
  /Arbeitsende muss nach dem Arbeitsbeginn liegen/,
)

assert.equal(buildIdempotencyKey('user-1', 'event-1'), 'user-1:event-1')
assert.throws(() => buildIdempotencyKey('', 'event-1'), /userId/)

assert.deepEqual(
  sanitizeAttendanceAuditPayload({
    action: 'clock-in',
    locationStatus: 'inside',
    offlineCaptured: false,
    radiusMeters: 500,
    latitude: 52.3,
    longitude: 9.7,
    actorEmail: 'private@example.com',
  }),
  {
    action: 'clock-in',
    locationStatus: 'inside',
    offlineCaptured: false,
    radiusMeters: 500,
  },
)

console.log('Attendance domain tests passed · GPS-aware location assertions included')
