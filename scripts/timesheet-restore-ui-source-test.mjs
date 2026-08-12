import fs from 'node:fs'
import assert from 'node:assert/strict'

const repo = fs.readFileSync('netlify/functions/_shared/timesheet-repository.mts', 'utf8')
const api = fs.readFileSync('netlify/functions/timesheets.mts', 'utf8')
const ui = fs.readFileSync('frontend/src/TimesheetMonthlyPage.jsx', 'utf8')
assert.match(repo, /export async function listSuppressedTimesheetEntries/)
assert.match(api, /suppressedEntries/)
assert.match(ui, /Gelöschte Dienstplan-Einträge/)
assert.match(ui, /Dienstplan übernehmen/)
assert.match(ui, /action:\s*'restore-schedule'/)
console.log('timesheet restore UI source contract passed')
