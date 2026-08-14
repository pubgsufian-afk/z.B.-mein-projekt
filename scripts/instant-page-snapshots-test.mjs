import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')
const timesheet = await readFile('frontend/src/TimesheetPage.jsx', 'utf8')

assert.match(app, /from '\.\/display-snapshots\.js'/)
assert.match(app, /schedule-display:/)
assert.match(app, /peekDisplaySnapshot\(scheduleSnapshotKey\)/)
assert.match(app, /setDisplaySnapshot\(scheduleSnapshotKey/)
assert.match(app, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('schedule-display:'\)\)/)
assert.match(app, /clearDisplaySnapshots\(\)/)

assert.match(timesheet, /from '\.\/display-snapshots\.js'/)
assert.match(timesheet, /timesheet-actual:/)
assert.match(timesheet, /timesheet-planned:/)
assert.match(timesheet, /peekDisplaySnapshot\(actualSnapshotKey\)/)
assert.match(timesheet, /peekDisplaySnapshot\(plannedSnapshotKey\)/)
assert.match(timesheet, /setDisplaySnapshot\(actualSnapshotKey/)
assert.match(timesheet, /setDisplaySnapshot\(plannedSnapshotKey/)
assert.match(timesheet, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('timesheet-'\)\)/)

console.log('instant-page-snapshots-test: PASS')
