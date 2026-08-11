import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/TimesheetPage.jsx'
let source = await readFile(path, 'utf8')
const fast = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"
const compatible = "      const data = await requestJson(`/api/attendance?${params}`)"

if (source.includes(fast)) {
  source = source.replace(fast, compatible)
  await writeFile(path, source)
}

const updated = await readFile(path, 'utf8')
assert.match(updated, /const historyTo = addDateDays\(to, 1\)/)
assert.match(updated, /const data = await requestJson\(`\/api\/attendance\?\$\{params\}`\)/)
assert.doesNotMatch(updated, /const historyPath = `\/api\/attendance\?\$\{params\}`/)
console.log('Timesheet overnight history remains compatible with repeated verification')
