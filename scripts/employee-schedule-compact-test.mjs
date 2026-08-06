import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const [app, css] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
])
assert.match(app, /sortedEmployeeEntries/)
assert.match(app, /employee-shift-list/)
assert.match(app, /employee-shift-card/)
assert.match(app, /management \? <div className="week-cards management-week-cards">/)
assert.match(app, /Für diese Woche ist kein freigegebener Dienst eingetragen/)
assert.match(app, /Dienstplan als PDF/)
assert.doesNotMatch(app, /!management && <div className="week-cards">/)
assert.match(css, /REPORTS_SCHEDULE_MOBILE_COMPACT/)
assert.match(css, /\.employee-shift-list/)
assert.match(css, /\.management-week-cards/)
console.log('Compact employee schedule tests passed')
