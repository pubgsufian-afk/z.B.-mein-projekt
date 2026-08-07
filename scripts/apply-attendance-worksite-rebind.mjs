import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/attendance.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('export function resolveScheduleWorksiteObjectId(')) {
  const marker = `export function attendanceFunctionMarkers() {`
  assert.ok(source.includes(marker), 'Attendance marker for worksite resolver is missing')
  const helper = `export function resolveScheduleWorksiteObjectId(
  schedule: ScheduleEntry | null | undefined,
  worksites: Array<{ id?: string; name?: string }> = [],
) {
  const originalId = String(schedule?.objectId || '').trim()
  if (!schedule) return originalId || null
  if (originalId && worksites.some((site) => String(site.id || '') === originalId)) return originalId
  const normalizedLocation = String(schedule.location || '').trim().toLocaleLowerCase('de-DE')
  if (!normalizedLocation) return originalId || null
  const current = worksites.find((site) => String(site.name || '').trim().toLocaleLowerCase('de-DE') === normalizedLocation)
  return String(current?.id || originalId || '').trim() || null
}

`
  source = source.replace(marker, `${helper}${marker}`)
}

if (!source.includes('async function loadWorksites()')) {
  const marker = `function schedulePayload(entry: ScheduleEntry | null) {`
  assert.ok(source.includes(marker), 'Attendance schedule payload marker is missing')
  const loader = `async function loadWorksites(): Promise<Array<{ id?: string; name?: string }>> {
  const { getStore } = await import('@netlify/blobs')
  const scheduleStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await scheduleStore.list({ prefix: 'objects/' })
  const rows = await Promise.all(listed.blobs.map((blob) => scheduleStore.get(blob.key, { type: 'json' }) as Promise<{ id?: string; name?: string } | null>))
  return rows.filter((entry): entry is { id?: string; name?: string } => Boolean(entry))
}

`
  source = source.replace(marker, `${loader}${marker}`)
}

const oldSafeBody = `    const safeBody = { ...body, scheduleId: schedule?.id || null, objectId: schedule?.objectId || null }`
const newSafeBody = `    const locationAction = normalized.action === 'clock-in' || normalized.action === 'clock-out'
    const worksiteObjectId = locationAction
      ? resolveScheduleWorksiteObjectId(schedule, await loadWorksites())
      : schedule?.objectId || null
    const safeBody = { ...body, scheduleId: schedule?.id || null, objectId: worksiteObjectId }`
if (!source.includes(newSafeBody)) {
  assert.ok(source.includes(oldSafeBody), 'Attendance safe-body marker is missing')
  source = source.replace(oldSafeBody, newSafeBody)
}

if (!source.includes('rebindsCurrentWorksite: true')) {
  const marker = `    requiresInsideWorksite: true,`
  assert.ok(source.includes(marker), 'Attendance feature marker is missing')
  source = source.replace(marker, `${marker}\n    rebindsCurrentWorksite: true,`)
}

await writeFile(path, source)
console.log('Attendance stale worksite rebinding applied')
