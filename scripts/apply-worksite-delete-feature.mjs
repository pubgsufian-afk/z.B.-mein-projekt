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

const worksiteStart = appSource.indexOf('function WorksitesPage() {')
const worksiteEnd = appSource.indexOf('\nfunction CorrectionsPage', worksiteStart)
assert.ok(worksiteStart >= 0 && worksiteEnd > worksiteStart, 'WorksitesPage-Bereich wurde nicht gefunden.')
let worksiteBlock = appSource.slice(worksiteStart, worksiteEnd)

if (!worksiteBlock.includes('async function removeObject(object)')) {
  const saveEndMarker = "    finally { setBusy(false) }\n  }\n"
  const saveEnd = worksiteBlock.indexOf(saveEndMarker)
  assert.ok(saveEnd >= 0, 'Einsatzort-Speichern-Ende wurde nicht gefunden.')
  const insertAt = saveEnd + saveEndMarker.length
  const removeHandler = `\n  async function removeObject(object) {\n    if (!object?.id) return\n    const confirmed = window.confirm(\`Einsatzort „\${object.name}“ wirklich löschen? Alte Dienstpläne bleiben unverändert.\`)\n    if (!confirmed) return\n    setBusy(true)\n    setNotice(null)\n    try {\n      await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'object-delete', id: object.id }) })\n      if (form.id === object.id) setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })\n      setNotice({ tone: 'success', text: 'Einsatzort wurde gelöscht. Alte Dienstpläne bleiben unverändert.' })\n      await load()\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n    finally { setBusy(false) }\n  }\n`
  worksiteBlock = worksiteBlock.slice(0, insertAt) + removeHandler + worksiteBlock.slice(insertAt)
}

if (!worksiteBlock.includes('Einsatzort löschen')) {
  const returnStart = worksiteBlock.indexOf('  return <><Notice notice={notice} />')
  const returnEnd = worksiteBlock.lastIndexOf('\n}')
  assert.ok(returnStart >= 0 && returnEnd > returnStart, 'Einsatzort-Oberfläche wurde nicht gefunden.')
  const worksiteReturn = `  return <>\n    <Notice notice={notice} />\n    <section className="panel">\n      <PageHeader title={form.id ? 'Einsatzort bearbeiten' : 'Einsatzort anlegen'} subtitle="Koordinaten werden nur zur Prüfung beim Ein- und Ausstempeln verwendet." />\n      <form className="worksite-form" onSubmit={save}>\n        <div className="form-grid"><label>Name<input value={form.name} onChange={update('name')} required /></label><label>Adresse<input value={form.address} onChange={update('address')} required /></label></div>\n        <div className="form-grid three"><label>Breitengrad<input inputMode="decimal" value={form.latitude} onChange={update('latitude')} /></label><label>Längengrad<input inputMode="decimal" value={form.longitude} onChange={update('longitude')} /></label><label>Prüfradius in Metern<input type="number" min="0" max="10000" value={form.radiusMeters} onChange={update('radiusMeters')} /></label></div>\n        <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Einsatzort speichern'}</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })}>Abbrechen</button>}</div>\n      </form>\n    </section>\n    <section className="panel">\n      <PageHeader title="Gespeicherte Einsatzorte" subtitle="Name, Adresse und Standortprüfung." />\n      {objects.length ? <div className="card-list">{objects.map((object) => <article className="worksite-card" key={object.id}>\n        <div><strong>{object.name}</strong><span>{object.address}</span></div>\n        <div><strong>{object.radiusMeters || 500} m</strong><span>Prüfradius</span></div>\n        <div className="row-actions">\n          <button type="button" className="secondary-button compact" disabled={busy} onClick={() => setForm({ id: object.id, name: object.name, address: object.address, latitude: object.latitude ?? '', longitude: object.longitude ?? '', radiusMeters: object.radiusMeters ?? 500 })}>Bearbeiten</button>\n          <button type="button" className="danger-outline compact" disabled={busy} onClick={() => removeObject(object)}>Einsatzort löschen</button>\n        </div>\n      </article>)}</div> : <Empty>Noch keine Einsatzorte gespeichert.</Empty>}\n    </section>\n  </>`
  worksiteBlock = worksiteBlock.slice(0, returnStart) + worksiteReturn + worksiteBlock.slice(returnEnd)
}

appSource = appSource.slice(0, worksiteStart) + worksiteBlock + appSource.slice(worksiteEnd)
assert.match(worksiteBlock, /async function removeObject\(object\)/)
assert.match(worksiteBlock, /action: 'object-delete'/)
assert.match(worksiteBlock, /window\.confirm/)
assert.match(worksiteBlock, /Einsatzort löschen/)
await writeFile(appPath, appSource)

console.log('Worksite delete backend, schedule autofill and worksite UI applied')
