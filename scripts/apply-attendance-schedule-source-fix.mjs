import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/attendance.mts'
let source = await readFile(path, 'utf8')

const oldLoader = `async function loadSchedules(): Promise<ScheduleEntry[]> {
  const { getStore } = await import('@netlify/blobs')
  const scheduleStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await scheduleStore.list({ prefix: 'shifts/' })
  const rows = await Promise.all(listed.blobs.map((blob) => scheduleStore.get(blob.key, { type: 'json' }) as Promise<ScheduleEntry | null>))
  return rows.filter((entry): entry is ScheduleEntry => Boolean(entry))
}`
const newLoader = `async function loadSchedules(): Promise<ScheduleEntry[]> {
  const { listScheduleShifts } = await import('./_shared/schedule-neon-repository.mts')
  return listScheduleShifts()
}`

if (!source.includes(newLoader)) {
  assert.ok(source.includes(oldLoader), 'Alte Blob-Dienstplanquelle der Zeiterfassung wurde nicht gefunden.')
  source = source.replace(oldLoader, newLoader)
}

await writeFile(path, source)
console.log('Attendance now reads the shared Neon schedule source')
