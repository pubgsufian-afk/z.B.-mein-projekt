import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('netlify/functions/timesheet-reports.mts', 'utf8')
assert.match(source, /ExcelJSModule\.default/)
console.log('timesheet Excel runtime compatibility contract passed')
