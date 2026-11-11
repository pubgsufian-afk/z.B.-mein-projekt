import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const [app, css] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
])
assert.match(app, /sortedEmployeeEntries/)
assert.match(app, /employee-shift-list/)
assert.match(app, /employee-shift-card/)
assert.match(app, /className="schedule-week-scroll"/)
assert.match(app, /className="week-cards management-week-cards"/)
assert.match(app, /Für diese Woche ist noch kein freigegebener Dienst eingetragen/)
assert.match(app, /Dienstplan als PDF/)
assert.doesNotMatch(app, /!management && <div className="week-cards">/)
assert.match(css, /REPORTS_SCHEDULE_MOBILE_COMPACT/)
assert.match(css, /\.employee-shift-list/)
assert.match(css, /\.management-week-cards/)
assert.match(css, /grid-template-columns: repeat\\(7, minmax\\(0, 1fr\\)\\)/)
assert.match(css, /width: 140%/)
assert.match(app, /schedule-mobile-day-detail/)
assert.match(app, /ScheduleDayContents/)
const { groupedScheduleShifts, dailyFreeEmployees } = await import('../frontend/src/schedule-week-presentation.mjs')
const groups = groupedScheduleShifts([
  { id: '3', employeeName: 'Omar', workArea: 'GMP Rundgang', start: '07:00' },
  { id: '1', employeeName: 'Adel', workArea: 'Brandwache', start: '18:00' },
  { id: '4', employeeName: 'Ahmed', workArea: 'ZuKo GMP', start: '07:00' },
  { id: '2', employeeName: 'Sufian', workArea: 'ZuKo', start: '06:00' },
])
assert.deepEqual(groups.map((group) => group.label), ['Brandwache', 'ZuKo', 'GMP'])
assert.deepEqual(groups[2].shifts.map((shift) => shift.employeeName), ['Ahmed', 'Omar'])
const free = dailyFreeEmployees({
  shifts: [{ employeeUserId: 'working' }],
  explicitDaysOff: [{ employeeUserId: 'manual', employeeName: 'Amin', source: 'manual' }],
  automaticUnassigned: [
    { userId: 'working', fullName: 'Schon eingeteilt' },
    { userId: 'manual', fullName: 'Amin' },
    { userId: 'placeholder', fullName: '12' },
    { userId: 'free', fullName: 'Osman' },
  ],
})
assert.deepEqual(free.map((entry) => entry.employeeName), ['Amin', 'Osman'])
assert.equal(free[0].explicit, true)
assert.equal(free[1].explicit, false)
console.log('Compact employee schedule, grouping and free-list tests passed')
