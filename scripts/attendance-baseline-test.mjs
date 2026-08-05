import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const requiredFiles = [
  'netlify/functions/_shared/attendance-domain.mjs',
  'netlify/functions/attendance.mts',
  'netlify/functions/schedule-v2.mts',
  'netlify/functions/attendance-maintenance.mts',
  'netlify/functions/reports-v2.mts',
  'netlify/functions/worksite-v2.mts',
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
for (const asset of ['attendance-v2.css', 'attendance-v2.js', 'live-attendance.js', 'schedule-v2.js', 'attendance-corrections.js', 'reports-v2.js']) {
  assert.match(index, new RegExp(asset.replace('.', '\\.')), `${asset} is not installed`)
}

const employeeUi = await readFile(path.join(root, 'public/attendance-v2.js'), 'utf8')
assert.doesNotMatch(employeeUi, /Pause starten|Pause beenden/, 'Employees must not control pauses')
assert.match(employeeUi, /clock-in[\s\S]*clock-out|Arbeitsbeginn[\s\S]*Arbeitsende/, 'Location flow must cover clock-in and clock-out')
assert.doesNotMatch(employeeUi, /watchPosition/, 'Background location tracking is forbidden')

const reportBackend = await readFile(path.join(root, 'netlify/functions/reports-v2.mts'), 'utf8')
assert.doesNotMatch(reportBackend, /drawText\([^\n]*(Unterschrift|signature)/i, 'V2 reports must not draw signature fields')
assert.doesNotMatch(reportBackend, /Geburtsdatum|Steuer-ID|private address|Personalnummer/i, 'V2 reports must not include private employee fields')

console.log(`Attendance V2 baseline complete · ${requiredFiles.length} required files`)
