import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8')
  let changed = false
  for (const { from, to } of replacements) {
    if (source.includes(to)) continue
    if (!source.includes(from)) throw new Error(`Worksite geolocation patch marker fehlt in ${path}: ${from.slice(0, 100)}`)
    source = source.replace(from, to)
    changed = true
  }
  if (changed) await writeFile(path, source)
  return changed
}

const changed = []

if (await patch('frontend/src/App.jsx', [
  {
    from: `  async function getLocation() {
    if (!navigator.geolocation) return null
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    ))
  }`,
    to: `  async function getLocation() {
    if (!navigator.geolocation) throw new Error('Die Standortbestimmung wird von diesem Gerät oder Browser nicht unterstützt.')
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
      (error) => {
        const message = error?.code === 1
          ? 'Standortzugriff ist für diese Webseite nicht erlaubt. Bitte den Standortzugriff im Browser erlauben und erneut versuchen.'
          : error?.code === 2
            ? 'Der aktuelle Standort konnte nicht ermittelt werden. Bitte Ortungsdienste und GPS prüfen und erneut versuchen.'
            : 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen.'
        reject(new Error(message))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    ))
  }`,
  },
  {
    from: `  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])`,
    to: `  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])`,
  },
  {
    from: `  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  async function save(event) {`,
    to: `  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function captureCurrentLocation() {
    if (!navigator.geolocation) {
      setNotice({ tone: 'error', text: 'Die Standortbestimmung wird von diesem Gerät oder Browser nicht unterstützt.' })
      return
    }
    setLocating(true)
    setNotice(null)
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      ))
      setForm((current) => ({
        ...current,
        latitude: position.coords.latitude.toFixed(7),
        longitude: position.coords.longitude.toFixed(7),
      }))
      setNotice({ tone: 'success', text: \`Aktueller Standort übernommen (Genauigkeit ca. \${Math.round(position.coords.accuracy || 0)} m). Bitte Einsatzort speichern.\` })
    } catch (error) {
      const text = error?.code === 1
        ? 'Standortzugriff ist für diese Webseite nicht erlaubt. Bitte den Standortzugriff im Browser erlauben und erneut versuchen.'
        : error?.code === 2
          ? 'Der aktuelle Standort konnte nicht ermittelt werden. Bitte Ortungsdienste und GPS prüfen und erneut versuchen.'
          : 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen.'
      setNotice({ tone: 'error', text })
    } finally { setLocating(false) }
  }

  async function save(event) {`,
  },
  {
    from: `    try { await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'object-upsert', ...form }) }); setNotice({ tone: 'success', text: 'Einsatzort wurde gespeichert.' }); setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 }); await load() }`,
    to: `    try { await apiJson('/api/worksite-v2', { method: 'POST', body: JSON.stringify(form) }); setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' }); setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 }); await load() }`,
  },
  {
    from: `<div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Einsatzort speichern'}</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })}>Abbrechen</button>}</div>`,
    to: `<div className="form-actions"><button type="button" className="secondary-button" disabled={busy || locating} onClick={captureCurrentLocation}>{locating ? 'Standort wird ermittelt …' : 'Aktuellen Standort übernehmen'}</button><button className="primary-button" disabled={busy || locating}>{busy ? 'Wird gespeichert …' : 'Einsatzort speichern'}</button>{form.id && <button type="button" className="secondary-button" disabled={locating} onClick={() => setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })}>Abbrechen</button>}</div>`,
  },
])) changed.push('App.jsx')

if (await patch('netlify/functions/worksite-v2.mts', [
  {
    from: `    await sql(
      \`INSERT INTO attendance_objects (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)`,
    to: `    await sql.query(
      \`INSERT INTO attendance_objects (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)`,
  },
])) changed.push('worksite-v2.mts')

if (await patch('netlify/functions/schedule-v2-neon.mts', [
  {
    from: `import { currentPortalActor } from './_shared/portal-role.mts'
import {`,
    to: `import { currentPortalActor } from './_shared/portal-role.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
import {`,
  },
  {
    from: `  const site: WorkSite = { id, name, address, latitude: lat, longitude: lon, radiusMeters: radius, updatedAt: new Date().toISOString(), updatedBy: current.userId }
  await legacyScheduleStore().setJSON(\`objects/\${id}\`, site)
  return json({ object: site }, 201)`,
    to: `  const site: WorkSite = { id, name, address, latitude: lat, longitude: lon, radiusMeters: radius, updatedAt: new Date().toISOString(), updatedBy: current.userId }
  await legacyScheduleStore().setJSON(\`objects/\${id}\`, site)

  const connectionString = databaseConnectionString()
  if (connectionString) {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(connectionString)
    await sql.query(
      \`INSERT INTO attendance_objects (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)
       VALUES ($1,$2,$3,NULL,$4,now(),$5)
       ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         radius_meters = EXCLUDED.radius_meters, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by\`,
      [id, lat, lon, radius, current.userId],
    )
  }
  return json({ object: site, databaseSynced: Boolean(connectionString) }, 201)`,
  },
])) changed.push('schedule-v2-neon.mts')

console.log(changed.length ? `Worksite geolocation fix applied: ${changed.join(', ')}` : 'Worksite geolocation fix already applied')
