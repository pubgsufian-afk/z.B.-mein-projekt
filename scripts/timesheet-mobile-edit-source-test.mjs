import fs from 'node:fs'
import assert from 'node:assert/strict'

const page = fs.readFileSync('frontend/src/TimesheetMonthlyPage.jsx', 'utf8')
const css = fs.readFileSync('frontend/src/timesheet.css', 'utf8')
assert.match(page, /timesheet-mobile-list/)
assert.match(page, /timesheet-mobile-card/)
assert.match(page, />Bearbeiten<\/button>/)
assert.match(page, />Löschen<\/button>/)
assert.match(page, /action:\s*'manual-delete'/)
assert.match(page, /method:\s*'DELETE'/)
assert.doesNotMatch(page, /\/api\/attendance/)
assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.timesheet-desktop-table[\s\S]*display:\s*none/)
assert.match(css, /@media \(min-width: 721px\)[\s\S]*\.timesheet-mobile-list[\s\S]*display:\s*none/)
console.log('timesheet mobile edit source contract passed')
