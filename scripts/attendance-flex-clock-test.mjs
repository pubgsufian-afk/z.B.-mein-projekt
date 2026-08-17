import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { flexStateForEligibility } from '../netlify/functions/attendance-flex.mts'

assert.deepEqual(
  flexStateForEligibility({ phase: 'blocked', schedule: null, clocking: { allowed: false, code: 'NO_PUBLISHED_SHIFT' } }, true),
  { phase: 'idle', schedule: null, clocking: { allowed: true, code: 'FLEX_ACCOUNT' } },
)
assert.deepEqual(
  flexStateForEligibility({ phase: 'blocked', schedule: null, clocking: { allowed: false, code: 'NO_PUBLISHED_SHIFT' } }, false),
  { phase: 'blocked', schedule: null, clocking: { allowed: false, code: 'NO_PUBLISHED_SHIFT' } },
)

const [api, patch] = await Promise.all([
  readFile('netlify/functions/attendance-flex.mts', 'utf8'),
  readFile('scripts/apply-attendance-flex-ui.mjs', 'utf8'),
])
assert.match(api, /ATTENDANCE_FLEX_ACCOUNT_EMAIL/)
assert.match(api, /isFlexClockAccount/)
assert.match(api, /findAllowedWorksite/)
assert.match(api, /createFlexAutoShift/)
assert.match(api, /createAttendanceService/)
assert.match(api, /service\.record/)
assert.match(api, /verifyRequestOrigin/)
assert.doesNotMatch(api, /info@habun-security\.de|Marwan Ziad/i)
assert.match(patch, /\/api\/attendance-flex\?resource=eligibility/)
assert.match(patch, /attendance-flex:/)
assert.doesNotMatch(patch, /info@habun-security\.de|Marwan Ziad/i)

console.log('private flex clock flow: ok')
