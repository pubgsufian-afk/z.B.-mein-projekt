import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const legacyPath = 'netlify/functions/schedule-v2.mts'
let legacy = await readFile(legacyPath, 'utf8')
if (!legacy.includes("path: '/api/schedule-v2-blob-legacy'")) {
  assert.ok(legacy.includes("export const config: Config = { path: '/api/schedule-v2' }"), 'Alte Dienstplanroute wurde nicht gefunden.')
  legacy = legacy.replace(
    "export const config: Config = { path: '/api/schedule-v2' }",
    "export const config: Config = { path: '/api/schedule-v2-blob-legacy' }",
  )
  await writeFile(legacyPath, legacy)
}

const assistPath = 'netlify/functions/schedule-assist-v2.mts'
let assist = await readFile(assistPath, 'utf8')
if (!assist.includes('async function loadSharedSchedule(request: Request)')) {
  const marker = `async function readMany<T>(prefix: string) {\n  const listed = await store().list({ prefix })\n  const values = await Promise.all(listed.blobs.map((blob) => store().get(blob.key, { type: 'json' }) as Promise<T | null>))\n  return values.filter((value): value is T => Boolean(value))\n}\n`
  assert.ok(assist.includes(marker), 'Assistenz-Ladefunktion wurde nicht gefunden.')
  const helper = `${marker}\nasync function loadSharedSchedule(request: Request) {\n  const url = new URL('/api/schedule-v2', request.url)\n  url.searchParams.set('resource', 'entries')\n  const response = await fetch(url, { headers: request.headers, cache: 'no-store' })\n  if (!response.ok) throw new Error('Dienstplan konnte für die Assistenz nicht geladen werden.')\n  const payload = await response.json().catch(() => ({})) as { entries?: Record<string, unknown>[] }\n  return Array.isArray(payload.entries) ? payload.entries : []\n}\n`
  assist = assist.replace(marker, helper)
}
if (!assist.includes('const shifts = await loadSharedSchedule(request)')) {
  assert.ok(assist.includes("const shifts = await readMany<Record<string, unknown>>('shifts/')"), 'Alter Assistenz-Dienstplanleser wurde nicht gefunden.')
  assist = assist.replace("const shifts = await readMany<Record<string, unknown>>('shifts/')", 'const shifts = await loadSharedSchedule(request)')
}
await writeFile(assistPath, assist)

const repositoryPath = 'netlify/functions/_shared/schedule-neon-repository.mts'
let repository = await readFile(repositoryPath, 'utf8')
if (!repository.includes('export async function rebindInactiveScheduleShifts()')) {
  const marker = `export async function upsertScheduleEmployee(employee: ScheduleEmployee) {\n  return syncScheduleEmployees([employee], false)\n}\n`
  assert.ok(repository.includes(marker), 'Einfügepunkt für Dienstplan-Neuverknüpfung wurde nicht gefunden.')
  const helper = `export async function rebindInactiveScheduleShifts() {\n  const database = getDatabase()\n  const result = await database.pool.query(\n    \`WITH unique_active AS (\n       SELECT lower(btrim(full_name)) AS name_key, MIN(user_id) AS user_id, MIN(full_name) AS full_name\n         FROM schedule_employees\n        WHERE status = 'active'\n        GROUP BY lower(btrim(full_name))\n       HAVING COUNT(*) = 1\n     )\n     UPDATE schedule_shifts s\n        SET employee_user_id = active.user_id,\n            employee_name = active.full_name,\n            updated_at = now(),\n            updated_by = 'identity-rebind'\n       FROM unique_active active\n      WHERE lower(btrim(s.employee_name)) = active.name_key\n        AND s.employee_user_id <> active.user_id\n        AND s.employee_user_id NOT LIKE 'guest:%'\n        AND NOT EXISTS (\n          SELECT 1 FROM schedule_employees stale\n           WHERE stale.user_id = s.employee_user_id AND stale.status = 'active'\n        )\n        AND NOT EXISTS (\n          SELECT 1 FROM schedule_shifts existing\n           WHERE existing.employee_user_id = active.user_id\n             AND existing.id <> s.id\n             AND existing.shift_date = s.shift_date\n             AND existing.start_time = s.start_time\n             AND existing.end_time = s.end_time\n             AND lower(btrim(existing.location)) = lower(btrim(s.location))\n             AND lower(btrim(existing.work_area)) = lower(btrim(s.work_area))\n        )\n     RETURNING s.id\`,\n  )\n  return result.rowCount || 0\n}\n\n${marker}`
  repository = repository.replace(marker, helper)
}
if (!repository.includes('if (markMissingInactive && clean.length) await rebindInactiveScheduleShifts()')) {
  const marker = `  return clean.length\n}\n\nexport async function rebindInactiveScheduleShifts()`
  assert.ok(repository.includes(marker), 'Aufrufpunkt für Dienstplan-Neuverknüpfung wurde nicht gefunden.')
  repository = repository.replace(
    marker,
    `  if (markMissingInactive && clean.length) await rebindInactiveScheduleShifts()\n  return clean.length\n}\n\nexport async function rebindInactiveScheduleShifts()`,
  )
}
await writeFile(repositoryPath, repository)

const neonSchedulePath = 'netlify/functions/schedule-v2-neon.mts'
let neonSchedule = await readFile(neonSchedulePath, 'utf8')
for (const bootstrapName of ['ensureLegacyScheduleMigrated', 'ensureSharedLegacyScheduleMigrated']) {
  const conditionalSync = `    await ${bootstrapName}()\n    if (SCHEDULING.has(String(current.role))) await syncActiveEmployees()`
  const unconditionalSync = `    await ${bootstrapName}()\n    await syncActiveEmployees()`
  if (neonSchedule.includes(conditionalSync)) {
    neonSchedule = neonSchedule.replace(conditionalSync, `    await ${bootstrapName}()`)
  }
  if (neonSchedule.includes(unconditionalSync)) {
    neonSchedule = neonSchedule.replace(unconditionalSync, `    await ${bootstrapName}()`)
  }
}
const handlerStart = neonSchedule.indexOf('export default async function scheduleV2Neon')
const routeStart = neonSchedule.indexOf('\n  const url = new URL(request.url)', handlerStart)
assert.ok(handlerStart >= 0 && routeStart > handlerStart, 'Dienstplan-Handler konnte für die Performance-Prüfung nicht eingegrenzt werden.')
assert.ok(!neonSchedule.slice(handlerStart, routeStart).includes('syncActiveEmployees()'), 'Mitarbeitersynchronisierung darf den normalen Dienstplan-Leseweg nicht blockieren.')
await writeFile(neonSchedulePath, neonSchedule)

console.log('Neon schedule source routing, re-registration rebinding and fast read path applied')
