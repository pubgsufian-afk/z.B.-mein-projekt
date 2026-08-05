import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const requiredFiles = [
  'netlify/functions/_shared/attendance-domain.mjs',
  'netlify/functions/attendance.mts',
  'public/attendance-core.js',
  'public/attendance-v2.js',
  'public/attendance-v2.css',
  'public/live-attendance.js',
  'public/schedule-v2.js',
  'public/reports-v2.js',
  'public/attendance-corrections.js',
]

for (const relativePath of requiredFiles) {
  await assert.doesNotReject(
    access(path.join(root, relativePath), constants.R_OK),
    `Missing Attendance V2 file: ${relativePath}`,
  )
}

const index = await readFile(path.join(root, 'public/index.html'), 'utf8')
assert.match(index, /attendance-v2\.css/, 'Attendance V2 stylesheet is not installed')
assert.match(index, /attendance-v2\.js/, 'Attendance V2 client is not installed')

const employeeUi = await readFile(path.join(root, 'public/attendance-v2.js'), 'utf8')
assert.doesNotMatch(employeeUi, /Pause starten|Pause beenden/, 'Employees must not control pauses')
assert.match(
  employeeUi,
  /clock-in[\s\S]*clock-out|Arbeitsbeginn[\s\S]*Arbeitsende/,
  'Location flow must cover clock-in and clock-out',
)

const reports = await readFile(path.join(root, 'public/reports-v2.js'), 'utf8')
assert.doesNotMatch(reports, /Unterschrift|signature/i, 'V2 reports must not contain signature fields')

console.log(`Attendance V2 baseline complete · ${requiredFiles.length} required files`)
