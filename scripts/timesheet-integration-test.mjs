import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync('frontend/src/App.jsx', 'utf8')
const timesheet = fs.readFileSync('frontend/src/TimesheetPage.jsx', 'utf8')
const service = fs.readFileSync('netlify/functions/_shared/attendance-service.mts', 'utf8')
const attendance = fs.readFileSync('netlify/functions/attendance.mts', 'utf8')
const reports = fs.readFileSync('netlify/functions/timesheet-reports.mts', 'utf8')

assert.match(app, /import TimesheetPage from '\.\/TimesheetPage\.jsx'/)
assert.match(app, /key: 'timesheet', label: 'Stundenzettel'/)
assert.doesNotMatch(app, /key: 'corrections', label: 'Korrekturen'/)
assert.match(app, /navigate\('timesheet'\).*Stundenzettel/)
assert.match(app, /page === 'timesheet' \? <TimesheetPage session=\{session\} \/>/)
assert.match(timesheet, /import \{ berlinDate \} from '\.\/berlin-date\.mjs'/)
assert.match(timesheet, /const sessionUserId = session\.userId \|\| session\.id \|\| ''/)
assert.match(timesheet, /const historyTo = addDateDays\(to, 1\)/)
assert.match(timesheet, /row\.date >= from && row\.date <= to/)
assert.match(timesheet, /String\(entry\.employeeUserId \|\| ''\) === String\(sessionUserId\)/)
assert.match(service, /current\.role === 'employee' \? current\.userId : normalizedText\(filters\.userId\)/)
assert.doesNotMatch(attendance, /resource === 'history'[\s\S]*?actor\.role === 'employee'[\s\S]*?FORBIDDEN/)
assert.match(reports, /index \+ 3/)

console.log('timesheet integration contract passed')