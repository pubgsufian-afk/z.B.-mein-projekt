import assert from 'node:assert/strict'
import {
  autoEventId,
  findAllowedWorksite,
  flexCheckoutDeadline,
  isFlexClockAccount,
  normalCheckoutDeadline,
} from '../netlify/functions/_shared/attendance-automation-policy.mts'

assert.equal(isFlexClockAccount('Special@Example.Test', 'special@example.test'), true)
assert.equal(isFlexClockAccount('other@example.test', 'special@example.test'), false)
assert.equal(isFlexClockAccount('', 'special@example.test'), false)

const sites = [
  { id: 'site-a', name: 'Objekt A', latitude: 52.375, longitude: 9.732, radiusMeters: 100 },
  { id: 'site-b', name: 'Objekt B', latitude: 52.39, longitude: 9.75, radiusMeters: 100 },
]
assert.equal(findAllowedWorksite(sites, { latitude: 52.3751, longitude: 9.7321, accuracyMeters: 10 })?.id, 'site-a')
assert.equal(findAllowedWorksite(sites, { latitude: 52.50, longitude: 9.90, accuracyMeters: 10 }), null)
assert.equal(findAllowedWorksite(sites, null), null)

assert.equal(flexCheckoutDeadline('2026-08-17T16:44:00Z').toISOString(), '2026-08-18T04:44:00.000Z')
assert.equal(normalCheckoutDeadline('2026-08-17T20:00:00Z').toISOString(), '2026-08-17T20:30:00.000Z')
assert.equal(autoEventId('clock-out', 'u1', '2026-08-17T20:30:00Z'), 'auto:clock-out:u1:2026-08-17T20:30:00.000Z')

console.log('attendance automation policy: ok')
