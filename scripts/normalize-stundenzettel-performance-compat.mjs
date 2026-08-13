import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

// Keeps the legacy timesheet patch repeatable after the performance layer has optimized its request.
const path = 'frontend/src/TimesheetPage.jsx'
let source = await readFile(path, 'utf8')

const optimized = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"
const legacyCompatible = "      const data = await requestJson(`/api/attendance?${params}`)"
const nightShiftMarker = "      const historyTo = addDateDays(to, 1)"
const filteredRowsMarker = "      const rows = buildActualSessions(data.entries || [], employeeNames).filter((row) => row.date >= from && row.date <= to)"
const filteredRowsRefMarker = "      const rows = buildActualSessions(data.entries || [], employeeNamesRef.current).filter((row) => row.date >= from && row.date <= to)"

if (source.includes(optimized)) {
  assert.ok(source.includes(nightShiftMarker), 'Optimierte Stundenzettel-Historie hat keinen Nachtschicht-Marker.')
  assert.ok(
    source.includes(filteredRowsMarker) || source.includes(filteredRowsRefMarker),
    'Optimierte Stundenzettel-Historie hat keinen Bereichsfilter.',
  )
  source = source.replace(optimized, legacyCompatible)
  await writeFile(path, source)
  console.log('Stundenzettel performance compatibility normalized')
} else {
  console.log('Stundenzettel performance compatibility already normalized')
}
