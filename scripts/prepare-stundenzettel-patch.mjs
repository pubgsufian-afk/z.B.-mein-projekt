import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-reports.mts'
let source = await readFile(path, 'utf8')
const before = "const placeholders = userIds.map((_, index) => `$${index + 4}`).join(', ')"
const after = "const placeholders = userIds.map((_, index) => `$${index + 3}`).join(', ')"
const placeholderPattern = /^\s*const placeholders = userIds\.map[^\n]*$/m

if (source.includes(before)) {
  console.log('Stundenzettel patch input already ready')
} else if (source.includes(after)) {
  source = source.replace(after, () => before)
  await writeFile(path, source)
  console.log('Stundenzettel patch input normalized')
} else {
  const match = source.match(placeholderPattern)
  assert.ok(match, 'Stundenzettel-Platzhalterzeile wurde nicht gefunden.')
  const indent = match[0].match(/^\s*/)?.[0] || ''
  source = source.replace(placeholderPattern, () => `${indent}${before}`)
  await writeFile(path, source)
  console.log('Stundenzettel patch input normalized from alternate formatting')
}
