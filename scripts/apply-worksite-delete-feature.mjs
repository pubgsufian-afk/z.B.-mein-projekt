import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-v2.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('async function deleteObject(')) {
  const marker = '\nexport default async function scheduleV2'
  assert.ok(source.includes(marker), 'schedule-v2 Export-Marker fehlt.')
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
  source = source.replace(marker, `${deletion}${marker}`)
}

if (!source.includes("if (action === 'object-delete')")) {
  const marker = "if (action === 'object-upsert') return await upsertObject(current, body)"
  assert.ok(source.includes(marker), 'object-upsert Aktionsmarker fehlt.')
  source = source.replace(marker, `${marker}\n    if (action === 'object-delete') return await deleteObject(current, body)`)
}

assert.match(source, /if \(action === 'object-delete'\) return await deleteObject\(current, body\)/)
assert.match(source, /if \(!\['owner', 'admin'\]\.includes\(current\.role\)\)/)
assert.match(source, /await store\(\)\.delete\(key\)/)

await writeFile(path, source)
console.log('Worksite delete backend applied')
