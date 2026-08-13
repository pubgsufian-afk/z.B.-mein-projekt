import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-reports.mts'
const before = "  const ExcelJS = await import('exceljs')"
const after = "  const ExcelJSModule = await import('exceljs')\n  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule"

let source = await readFile(path, 'utf8')
if (!source.includes(after)) {
  assert.ok(source.includes(before), 'ExcelJS-Import im Stundenzettel-Export wurde nicht gefunden.')
  source = source.replace(before, after)
  await writeFile(path, source)
  console.log('Stundenzettel Excel ESM compatibility applied')
} else {
  console.log('Stundenzettel Excel ESM compatibility already applied')
}
