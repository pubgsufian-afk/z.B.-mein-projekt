import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const timesheetPath = 'frontend/src/TimesheetPage.jsx'
let timesheet = await readFile(timesheetPath, 'utf8')

const refCurrentMarker = "      setPlanned({ rows: buildPlannedRows(entries, employeeNamesRef.current), error: '' })"
const legacyMarker = "      setPlanned({ rows: buildPlannedRows(entries, employeeNames), error: '' })"
const optimizedMarker = "      const plannedRows = buildPlannedRows(entries, employeeNamesRef.current)"

if (!timesheet.includes(optimizedMarker) && timesheet.includes(refCurrentMarker)) {
  timesheet = timesheet.replace(refCurrentMarker, legacyMarker)
  await writeFile(timesheetPath, timesheet)
}

await import('./apply-instant-portal-data-performance.mjs')

timesheet = await readFile(timesheetPath, 'utf8')
const patchedLegacyMarker = "      const plannedRows = buildPlannedRows(entries, employeeNames)"
if (timesheet.includes(patchedLegacyMarker)) {
  timesheet = timesheet.replace(patchedLegacyMarker, optimizedMarker)
  await writeFile(timesheetPath, timesheet)
}

const verified = await readFile(timesheetPath, 'utf8')
assert.match(verified, /const plannedRows = buildPlannedRows\(entries, employeeNamesRef\.current\)/)
assert.match(verified, /setDisplaySnapshot\(plannedSnapshotKey/)
console.log('Instant portal data compatibility retained')
