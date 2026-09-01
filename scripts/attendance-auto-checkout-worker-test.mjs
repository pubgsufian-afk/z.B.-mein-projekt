import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  automaticActionsForPhase,
  checkoutDeadlineForSession,
} from '../netlify/functions/attendance-auto-checkout.mts'
import { autoCheckoutAtForState } from '../netlify/functions/attendance.mts'

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

assert.equal(
  autoCheckoutAtForState(
    { phase: 'working', clockInAt: '2026-09-01T03:30:00.000Z' },
    { employeeUserId: 'employee-1', source: 'portal', scheduledEndAt: '2026-09-01T15:00:00.000Z' },
    'employee-1',
  )?.toISOString(),
  '2026-09-01T15:30:00.000Z',
  'normal shifts must use their own planned end plus 30 minutes',
)
assert.equal(
  autoCheckoutAtForState(
    { phase: 'paused', clockInAt: '2026-09-01T20:00:00.000Z' },
    { employeeUserId: 'employee-1', source: 'portal', scheduledEndAt: '2026-09-02T04:00:00.000Z' },
    'employee-1',
  )?.toISOString(),
  '2026-09-02T04:30:00.000Z',
  'overnight shifts must use the next-day planned end plus 30 minutes',
)
assert.equal(
  autoCheckoutAtForState(
    { phase: 'completed', clockInAt: '2026-09-01T03:30:00.000Z' },
    { employeeUserId: 'employee-1', source: 'portal', scheduledEndAt: '2026-09-01T15:00:00.000Z' },
    'employee-1',
  ),
  null,
  'completed shifts must never schedule another auto checkout',
)
assert.equal(
  autoCheckoutAtForState(
    { phase: 'working', clockInAt: '2026-09-01T03:30:00.000Z' },
    { employeeUserId: 'employee-2', source: 'portal', scheduledEndAt: '2026-09-01T15:00:00.000Z' },
    'employee-1',
  ),
  null,
  'a shift belonging to another employee must never be used',
)

const [source, attendance, patch] = await Promise.all([
  readFile('netlify/functions/attendance-auto-checkout.mts', 'utf8'),
  readFile('netlify/functions/attendance.mts', 'utf8'),
  readFile('scripts/apply-sparse-attendance-auto-checkout.mjs', 'utf8'),
])

assert.match(source, /listOpenSessions/)
assert.match(source, /system:auto-checkout/)
assert.match(source, /autoEventId/)
assert.match(source, /nextPublishedShiftStart/)
assert.match(source, /finishFlexAutoShift/)
assert.match(source, /clientOccurredAt:\s*deadline\.toISOString\(\)/)
assert.match(source, /export\s+async\s+function\s+runAutoCheckoutForUser/,
  'employee-scoped reconciliation must be available without a global poll')
assert.match(source, /schedule:\s*'@daily'/,
  'global safety scan must run only once per day')
assert.doesNotMatch(source, /schedule:\s*'\*\/15 \* \* \* \*'/,
  '15-minute global polling must be removed')

assert.match(attendance, /autoCheckoutAtForState/)
assert.match(attendance, /runAutoCheckoutForUser\(actor\.userId/,
  'existing state loads must reconcile only the authenticated employee when due')
assert.match(attendance, /autoCheckoutAt/,
  'state responses must expose the exact per-shift deadline to the visible app')

assert.match(patch, /state\.autoCheckoutAt/,
  'the sparse UI patch must consume the exact server-calculated deadline')
assert.match(patch, /window\.setTimeout/,
  'the sparse UI patch must schedule one local wake-up instead of polling the backend')
assert.match(patch, /await\s+load\(\)/,
  'the local wake-up should reuse the existing state load instead of adding another API')
assert.doesNotMatch(patch, /setInterval/,
  'the sparse UI patch must not introduce another recurring browser poll')

console.log('sparse automatic checkout contract: ok')
