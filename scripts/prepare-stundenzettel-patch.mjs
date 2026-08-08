import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-reports.mts'
let source = await readFile(path, 'utf8')
const placeholderPattern = /^\s*const placeholders = userIds\.map[^\n]*$/m
const match = source.match(placeholderPattern)
assert.ok(match, 'Stundenzettel-Platzhalterzeile wurde nicht gefunden.')

const indent = match[0].match(/^\s*/)?.[0] || ''
const expectedInput = `${indent}const placeholders = userIds.map((_, index) => \`$\${index + 4}\`).join(', ')`

if (match[0] !== expectedInput) {
  source = source.replace(placeholderPattern, expectedInput)
  await writeFile(path, source)
  console.log('Stundenzettel patch input normalized')
} else {
  console.log('Stundenzettel patch input already ready')
}
