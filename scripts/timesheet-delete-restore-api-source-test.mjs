import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheets.mts', 'utf8')
assert.match(source, /suppressTimesheetEntry/)
assert.match(source, /restoreScheduleTimesheetEntry/)
assert.match(source, /action === 'manual-delete'/)
assert.match(source, /existing\.scheduleShiftId[\s\S]*suppressTimesheetEntry/)
assert.match(source, /action === 'restore-schedule'/)
assert.match(source, /isTimesheetScheduleSyncOpen\(monthKeyForDate\(existing\.workDate\), now\)/)
assert.match(source, /action: 'manual-delete'/)
assert.match(source, /action: 'schedule-restore'/)
console.log('timesheet delete/restore api source contract passed')
