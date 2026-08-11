import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, repository] = await Promise.all([
  readFile('netlify/functions/timesheets.mts', 'utf8'),
  readFile('netlify/functions/_shared/timesheet-manual-repository.mts', 'utf8'),
])
assert.match(source, /requirePortalRole/)
assert.match(source, /verifyRequestOrigin/)
assert.match(source, /manual-update/)
assert.match(repository, /manual_override = true/)
assert.match(source, /writeTimesheetAudit/)
assert.match(source, /syncPublishedScheduleRange/)
assert.doesNotMatch(source, /attendance_events|\/api\/attendance/)
console.log('timesheet api source contract passed')
