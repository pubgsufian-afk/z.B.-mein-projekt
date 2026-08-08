import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-reports.mts'
let source = await readFile(path, 'utf8')
const placeholderPattern = /const placeholders = userIds\.map\(\(_, index\) => `\$\$\{index \+ \d+\}`\)\.join\(', '\)/
const expectedInput = "const placeholders = userIds.map((_, index) => `$${index + 4}`).join(', ')"
const match = source.match(placeholderPattern)
assert.ok(match, 'Stundenzettel-Platzhalterzeile wurde nicht gefunden.')

if (match[0] !== expectedInput) {
  source = source.replace(placeholderPattern, expectedInput)
  await writeFile(path, source)
  console.log('Stundenzettel patch input normalized')
} else {
  console.log('Stundenzettel patch input already ready')
}
