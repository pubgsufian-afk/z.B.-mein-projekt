import assert from 'node:assert/strict'
import { classifyLocation } from '../netlify/functions/_shared/attendance-domain.mjs'

const toleratedGpsDrift = classifyLocation(390, true, true, 200, 220)
assert.equal(toleratedGpsDrift.status, 'inside', 'GPS accuracy must be included as a bounded tolerance around the configured worksite radius')
assert.equal(toleratedGpsDrift.accuracyMeters, 220)
assert.equal(toleratedGpsDrift.accuracyToleranceMeters, 220)
assert.equal(toleratedGpsDrift.allowedDistanceMeters, 420)

const cappedBadFix = classifyLocation(500, true, true, 200, 5000)
assert.equal(cappedBadFix.status, 'outside', 'very inaccurate GPS must not grant an unlimited geofence')
assert.equal(cappedBadFix.accuracyToleranceMeters, 250)
assert.equal(cappedBadFix.allowedDistanceMeters, 450)

const exactFix = classifyLocation(201, true, true, 200, 0)
assert.equal(exactFix.status, 'outside', 'without GPS uncertainty the configured radius remains strict')
assert.equal(exactFix.allowedDistanceMeters, 200)

console.log('Location accuracy tolerance tests passed')
