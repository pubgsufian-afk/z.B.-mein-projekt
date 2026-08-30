import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('frontend/src/TimesheetPage.jsx', 'utf8')
const summary = fs.readFileSync('frontend/src/TimesheetSummary.jsx', 'utf8')
const netlify = fs.readFileSync('netlify.toml', 'utf8')
const indexHtml = fs.readFileSync('public/index.html', 'utf8')

assert.match(page, /mergeTimesheetRows/)
assert.match(page, /Dienstplanstunden werden automatisch/)
assert.match(page, /\/api\/attendance-time-edit/)
assert.match(page, /\/api\/attendance-time-create/)
assert.match(page, /\/api\/timesheet-reports/)
assert.match(page, /scope:\s*'unified'/)
assert.doesNotMatch(page, /\/api\/timesheet-export/)
assert.match(page, /scheduleId/)
assert.match(page, /Aus Dienstplan/)
assert.match(page, /Stundenzettel PDF/)
assert.match(page, /Stundenzettel Excel/)
assert.match(summary, /Stundenübersicht/)
assert.match(summary, /Arbeitstage/)
assert.match(summary, /Einträge pro Seite/)
assert.match(summary, /summarizeTimesheetRows/)
assert.doesNotMatch(page, /Arbeitsstunden – tatsächlich/)
assert.doesNotMatch(page, /Dienstplanstunden – geplant/)
assert.doesNotMatch(page, /Begründung/)
assert.doesNotMatch(page, /Korrektur beantragen/)

// Force one fresh frontend URL after the accidentally long-lived asset cache, then revalidate future updates.
assert.match(indexHtml, /\/assets\/habun-portal\.js\?v=20260813-speed1/)
assert.match(indexHtml, /\/assets\/habun-portal\.css\?v=20260813-speed1/)
assert.match(netlify, /for = "\/assets\/\*"[\s\S]*Cache-Control = "public, max-age=0, must-revalidate"/)
assert.doesNotMatch(netlify, /for = "\/assets\/\*"[\s\S]*Cache-Control = "[^"]*immutable/)

console.log('unified timesheet page source contract passed')
