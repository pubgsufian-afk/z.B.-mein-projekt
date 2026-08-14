import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BERLIN_TIME_ZONE,
  berlinDateKey,
  isIsoDateKey,
  safePdfFilenamePart,
} from '../netlify/functions/_shared/daily-report-model.mts'

assert.equal(BERLIN_TIME_ZONE, 'Europe/Berlin')
assert.equal(isIsoDateKey('2026-08-14'), true)
assert.equal(isIsoDateKey('14.08.2026'), false)
assert.equal(isIsoDateKey('2026-02-30'), false)
assert.equal(isIsoDateKey('2026-13-01'), false)
assert.equal(berlinDateKey('2026-08-14T22:30:00.000Z'), '2026-08-15')
assert.equal(safePdfFilenamePart('Ädmin / Test'), 'Admin-Test')

const source = readFileSync(new URL('../netlify/functions/daily-reports.mts', import.meta.url), 'utf8')
for (const token of ['PATCH', 'DELETE', 'updatedAt', 'updatedById', 'updatedByName']) {
  assert.match(source, new RegExp(token), `daily-reports.mts must contain ${token}`)
}
assert.match(source, /verifyRequestOrigin/, 'write operations must verify request origin')
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/, 'daily report API must stay owner/admin only')
assert.match(source, /findDailyReportById/, 'PATCH/DELETE must resolve report ids server-side')
assert.doesNotMatch(source, /body\?\.key|body\.key/, 'browser must never choose the internal blob key')

console.log('daily report CRUD contract: ok')
