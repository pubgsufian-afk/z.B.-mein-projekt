import assert from 'node:assert/strict'
import { isTimesheetScheduleSyncOpen } from '../netlify/functions/_shared/timesheet-month-policy.mts'

const now = new Date('2026-08-11T21:30:00Z')
assert.equal(isTimesheetScheduleSyncOpen('2026-08', now), true, 'August 2026 must still be schedule-synchronized')
assert.equal(isTimesheetScheduleSyncOpen('2026-07', now), false, 'July 2026 must not be rebuilt from a later schedule')
console.log('timesheet bootstrap policy passed')
