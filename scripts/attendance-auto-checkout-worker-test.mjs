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

const source = await readFile('netlify/functions/attendance-auto-checkout.mts', 'utf8')
assert.match(source, /listOpenSessions/)
assert.match(source, /system:auto-checkout/)
assert.match(source, /autoEventId/)
assert.match(source, /nextPublishedShiftStart/)
assert.match(source, /finishFlexAutoShift/)
assert.match(source, /clientOccurredAt:\s*deadline\.toISOString\(\)/)
assert.match(source, /schedule:\s*'\*\/15 \* \* \* \*'/, 'automatic checkout should leave database idle windows between runs')

console.log('automatic checkout worker contract: ok')
