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
assert.match(api, /ATTENDANCE_FLEX_ACCOUNT_EMAILS/)
assert.match(api, /isFlexClockAccount/)
assert.doesNotMatch(api, /findAllowedWorksite/)
assert.match(api, /createFlexAutoShift/)
assert.match(api, /createAttendanceService/)
assert.match(api, /allowRemoteClockIn: true/)
assert.match(api, /REMOTE_WORKSITE/)
assert.match(api, /break-start/)
assert.match(api, /resource === 'eligibility'/)
assert.match(api, /resource !== 'state'/)
assert.match(api, /service\.record/)
assert.match(api, /verifyRequestOrigin/)
assert.doesNotMatch(api, /ATTENDANCE_FLEX_ACCOUNT_EMAIL\s*=\s*['"][^'"]+['"]/)
assert.match(patch, /\/api\/attendance-flex\?resource=eligibility/)
assert.match(patch, /resource=state/)
assert.match(patch, /Boolean\(state\.flexEligible\)/)
assert.match(patch, /state\.flexSession/)
assert.match(patch, /needsLocation = !useFlexEndpoint/)
assert.doesNotMatch(patch, /ATTENDANCE_FLEX_ACCOUNT_EMAILS/)

console.log('private flex clock flow: ok')
