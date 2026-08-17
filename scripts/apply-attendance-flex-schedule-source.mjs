import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/_shared/schedule-neon-repository.mts'
let source = await readFile(path, 'utf8')

const oldType = "export type ScheduleSource = 'portal' | 'chatgpt' | 'legacy-blob'"
const newType = "export type ScheduleSource = 'portal' | 'chatgpt' | 'legacy-blob' | 'attendance-flex'"
if (!source.includes(newType)) {
  assert.ok(source.includes(oldType), 'ScheduleSource type marker not found')
  source = source.replace(oldType, newType)
}

const oldMap = "    source: row.source === 'chatgpt' ? 'chatgpt' : row.source === 'legacy-blob' ? 'legacy-blob' : 'portal',"
const newMap = "    source: row.source === 'attendance-flex' ? 'attendance-flex' : row.source === 'chatgpt' ? 'chatgpt' : row.source === 'legacy-blob' ? 'legacy-blob' : 'portal',"
if (!source.includes(newMap)) {
  assert.ok(source.includes(oldMap), 'Schedule source mapping marker not found')
  source = source.replace(oldMap, newMap)
}

await writeFile(path, source)
console.log('Attendance flex schedule source preserved')
