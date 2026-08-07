import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const schedulePath = 'netlify/functions/schedule-v2.mts'
let scheduleSource = await readFile(schedulePath, 'utf8')

if (!scheduleSource.includes('async function deleteObject(')) {
  const marker = '\nexport default async function scheduleV2'
  assert.ok(scheduleSource.includes(marker), 'schedule-v2 Export-Marker fehlt.')
  const deletion = `
async function deleteObject(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!['owner', 'admin'].includes(current.role)) {
    return json({ message: 'Nur die Administration darf Einsatzorte löschen.' }, 403)
  }
  const id = String(body.id || '').trim()
  if (!id) return json({ message: 'Der Einsatzort fehlt.' }, 400)

  const key = \`objects/\${id}\`
  const existing = await store().get(key, { type: 'json' }) as WorkSite | null
  if (!existing) return json({ message: 'Der Einsatzort wurde nicht gefunden.' }, 404)

  await store().delete(key)
  return json({ deleted: true, id })
}
`
  scheduleSource = scheduleSource.replace(marker, `${deletion}${marker}`)
}

if (!scheduleSource.includes("if (action === 'object-delete')")) {
  const marker = "if (action === 'object-upsert') return await upsertObject(current, body)"
  assert.ok(scheduleSource.includes(marker), 'object-upsert Aktionsmarker fehlt.')
  scheduleSource = scheduleSource.replace(marker, `${marker}\n    if (action === 'object-delete') return await deleteObject(current, body)`)
}

assert.match(scheduleSource, /if \(action === 'object-delete'\) return await deleteObject\(current, body\)/)
assert.match(scheduleSource, /if \(!\['owner', 'admin'\]\.includes\(current\.role\)\)/)
assert.match(scheduleSource, /await store\(\)\.delete\(key\)/)
await writeFile(schedulePath, scheduleSource)

const appPath = 'frontend/src/App.jsx'
let appSource = await readFile(appPath, 'utf8')
const scheduleStart = appSource.indexOf('function SchedulePage({ session }) {')
const scheduleEnd = appSource.indexOf('\nfunction TimesPage', scheduleStart)
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'SchedulePage-Bereich wurde nicht gefunden.')
let scheduleBlock = appSource.slice(scheduleStart, scheduleEnd)

if (!scheduleBlock.includes('function selectScheduleObject(event)')) {
  const updateMarker = "  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))"
  assert.ok(scheduleBlock.includes(updateMarker), 'Dienstplan-Update-Marker fehlt.')
  const handler = `${updateMarker}\n\n  function selectScheduleObject(event) {\n    const objectId = event.target.value\n    const object = objects.find((item) => item.id === objectId)\n    setForm((current) => ({\n      ...current,\n      objectId,\n      location: object ? object.name : '',\n    }))\n  }`
  scheduleBlock = scheduleBlock.replace(updateMarker, handler)
}

const oldSelect = "<select value={form.objectId} onChange={update('objectId')}>"
const newSelect = '<select value={form.objectId} onChange={selectScheduleObject}>'
if (!scheduleBlock.includes(newSelect)) {
  assert.ok(scheduleBlock.includes(oldSelect), 'Gespeicherte-Einsatzort-Auswahl wurde nicht gefunden.')
  scheduleBlock = scheduleBlock.replace(oldSelect, newSelect)
}

appSource = appSource.slice(0, scheduleStart) + scheduleBlock + appSource.slice(scheduleEnd)
assert.match(scheduleBlock, /function selectScheduleObject\(event\)/)
assert.match(scheduleBlock, /location: object \? object\.name : ''/)
assert.match(scheduleBlock, /onChange=\{selectScheduleObject\}/)
await writeFile(appPath, appSource)

console.log('Worksite delete backend and schedule autofill applied')
