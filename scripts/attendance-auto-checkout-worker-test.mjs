import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  automaticActionsForPhase,
  checkoutDeadlineForSession,
} from '../netlify/functions/attendance-auto-checkout.mts'

assert.equal(
  checkoutDeadlineForSession(
    { clockInAt: '2026-08-17T16:44:00.000Z' },
    { source: 'attendance-flex', scheduledEndAt: '2026-08-18T04:44:00.000Z' },
  ).toISOString(),
  '2026-08-18T04:44:00.000Z',
)
assert.equal(
  checkoutDeadlineForSession(
    { clockInAt: '2026-08-17T05:00:00.000Z' },
    { source: 'portal', scheduledEndAt: '2026-08-17T20:00:00.000Z' },
  ).toISOString(),
  '2026-08-17T20:30:00.000Z',
)
assert.deepEqual(automaticActionsForPhase('working'), ['clock-out'])
assert.deepEqual(automaticActionsForPhase('paused'), ['break-end', 'clock-out'])

const [source, attendance, app] = await Promise.all([
  readFile('netlify/functions/attendance-auto-checkout.mts', 'utf8'),
  readFile('netlify/functions/attendance.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])

assert.match(source, /listOpenSessions/)
assert.match(source, /system:auto-checkout/)
assert.match(source, /autoEventId/)
assert.match(source, /nextPublishedShiftStart/)
assert.match(source, /finishFlexAutoShift/)
assert.match(source, /clientOccurredAt:\s*deadline\.toISOString\(\)/)
assert.match(source, /export\s+async\s+function\s+runAutoCheckoutForUser/,
  'employee-driven reconciliation must be available without a global poll')
assert.match(source, /schedule:\s*'@daily'/,
  'global safety scan must run only once per day')
assert.doesNotMatch(source, /schedule:\s*'\*\/15 \* \* \* \*'/,
  '15-minute global polling must be removed')

assert.match(attendance, /resource\s*===\s*['"]auto-checkout['"]/,
  'attendance API must expose authenticated self auto-checkout')
assert.match(attendance, /runAutoCheckoutForUser\(actor\.userId/,
  'auto-checkout endpoint must be scoped to the authenticated employee')

assert.match(app, /autoCheckoutAt/,
  'attendance state must expose and consume the per-shift automatic checkout deadline')
assert.match(app, /window\.setTimeout/,
  'the visible app should schedule one local wake-up instead of polling the backend')
assert.match(app, /resource:\s*['"]auto-checkout['"]/,
  'the local wake-up must request only the authenticated employee auto-checkout')

console.log('sparse automatic checkout contract: ok')
