import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { berlinDate } from '../frontend/src/berlin-date.mjs'
import { attendanceEventNeedsReview } from '../netlify/functions/_shared/report-warning.mjs'
import { sameScheduleShift } from '../netlify/functions/_shared/schedule-copy-guard.mjs'

assert.equal(berlinDate(new Date('2026-01-01T00:30:00+01:00')), '2026-01-01')
assert.equal(berlinDate(new Date('2026-08-06T22:30:00Z')), '2026-08-07')

assert.equal(attendanceEventNeedsReview({ action: 'break-start', location_status: 'unavailable', offline_captured: false }), false)
assert.equal(attendanceEventNeedsReview({ action: 'break-end', location_status: 'unavailable', offline_captured: false }), false)
assert.equal(attendanceEventNeedsReview({ action: 'clock-in', location_status: 'outside', offline_captured: false }), true)
assert.equal(attendanceEventNeedsReview({ action: 'clock-out', location_status: 'inside', offline_captured: true }), true)
assert.equal(attendanceEventNeedsReview({ action: 'clock-out', location_status: 'inside', offline_captured: false }), false)

const existing = { employeeUserId: 'employee-1', date: '2026-08-10', start: '07:00', end: '17:00', location: 'Objekt Nord', workArea: 'Zutrittskontrolle' }
const duplicate = { ...existing, id: 'another-id', status: 'draft' }
const different = { ...existing, start: '08:00' }
assert.equal(sameScheduleShift(existing, duplicate), true)
assert.equal(sameScheduleShift(existing, different), false)

const appSource = await readFile('frontend/src/App.jsx', 'utf8')
assert.match(appSource, /import \{ berlinDate \} from '\.\/berlin-date\.mjs'/)
assert.doesNotMatch(appSource, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/)

const reportSource = await readFile('netlify/functions/unified-reports.mts', 'utf8')
assert.match(reportSource, /attendanceEventNeedsReview/)
assert.doesNotMatch(reportSource, /current\.events\.some\(\(event\) => event\.location_status !== 'inside' \|\| event\.offline_captured\)/)

const reportFilterSource = await readFile('public/report-filter-fix.js', 'utf8')
assert.match(reportFilterSource, /summary\.textContent !== summaryText/)
assert.match(reportFilterSource, /button\.getAttribute\('aria-checked'\) !== checked/)
assert.doesNotMatch(reportFilterSource, /if \(summary\) summary\.textContent = selected\.length/)

const scheduleSource = await readFile('netlify/functions/schedule-v2.mts', 'utf8')
assert.match(scheduleSource, /sameScheduleShift/)
assert.match(scheduleSource, /if \(targetRows\.some\(\(entry\) => sameScheduleShift\(entry, copy\)\)\) continue/)

console.log('Portal audit regression tests passed')
