import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const repositoryPath = 'netlify/functions/_shared/schedule-neon-repository.mts'
let repository = await readFile(repositoryPath, 'utf8')
if (!repository.includes('HABUN_SCHEDULE_DATABASE_URL')) {
  assert.ok(repository.includes("import { getDatabase } from '@netlify/database'"), 'Dienstplan-Datenbankimport wurde nicht gefunden.')
  assert.ok(repository.includes('const database = getDatabase()'), 'Dienstplan-Datenbankaufrufe wurden nicht gefunden.')
  repository = repository.replaceAll('const database = getDatabase()', 'const database = getScheduleDatabase()')
  repository = repository.replace(
    "import { getDatabase } from '@netlify/database'",
    `import { getDatabase } from '@netlify/database'\n\nfunction getScheduleDatabase() {\n  const connectionString = typeof Netlify !== 'undefined'\n    ? String(Netlify.env.get('HABUN_SCHEDULE_DATABASE_URL') || '').trim()\n    : ''\n  return connectionString ? getDatabase({ connectionString }) : getDatabase()\n}`,
  )
  await writeFile(repositoryPath, repository)
}

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

console.log('Neon schedule source routing applied')
