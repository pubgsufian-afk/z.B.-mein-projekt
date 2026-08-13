import assert from 'node:assert/strict'
import fs from 'node:fs'

const timesheet = fs.readFileSync('frontend/src/TimesheetPage.jsx', 'utf8')
const netlify = fs.readFileSync('netlify.toml', 'utf8')

assert.match(timesheet, /Promise\.all\(\[directoryPromise, historyPromise, schedulePromise\]\)/)
assert.doesNotMatch(timesheet, /useEffect\(\(\) => \{ loadDirectory\(\) \}, \[loadDirectory\]\)/)
assert.match(netlify, /for = "\/assets\/\*"[\s\S]*Cache-Control = "public, max-age=31536000, immutable"/)

console.log('timesheet and static asset performance contract passed')
