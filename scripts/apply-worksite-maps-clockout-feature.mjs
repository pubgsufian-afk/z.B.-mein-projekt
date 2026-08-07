import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
assert.ok(app.includes('function requestCurrentDeviceLocation()'), 'Gemeinsame Standortfunktion muss vor dem Maps-Feature angewendet sein.')

const oldAttendanceLocation = `      const needsLocation = action === 'clock-in' || action === 'clock-out'
      const location = needsLocation ? await requestCurrentDeviceLocation() : null`
const newAttendanceLocation = `      let location = null
      if (action === 'clock-in') {
        location = await requestCurrentDeviceLocation()
      } else if (action === 'clock-out') {
        try { location = await requestCurrentDeviceLocation() } catch { location = null }
      }`
if (!app.includes(newAttendanceLocation)) {
  assert.ok(app.includes(oldAttendanceLocation), 'Standortlogik der Zeiterfassung wurde nicht gefunden.')
  app = app.replace(oldAttendanceLocation, newAttendanceLocation)
}

const worksiteStart = app.indexOf('function WorksitesPage() {')
const worksiteEnd = app.indexOf('\nfunction CorrectionsPage', worksiteStart)
assert.ok(worksiteStart >= 0 && worksiteEnd > worksiteStart, 'WorksitesPage wurde nicht gefunden.')

const worksiteBlock = `function WorksitesPage() {
  const emptyForm = { id: '', name: '', address: '', mapsUrl: '', latitude: '', longitude: '', radiusMeters: 500 }
  const [objects, setObjects] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [resolvingMap, setResolvingMap] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])
  useEffect(() => { load() }, [load])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const resetForm = () => setForm(emptyForm)

  async function captureCurrentLocation() {
    setLocating(true)
    setNotice(null)
    try {
      const location = await requestCurrentDeviceLocation()
      setForm((current) => ({
        ...current,
        latitude: location.latitude.toFixed(7),
        longitude: location.longitude.toFixed(7),
      }))
      setNotice({ tone: 'success', text: 'Aktueller Standort übernommen (Genauigkeit ca. ' + Math.round(location.accuracyMeters || 0) + ' m). Bitte Radius prüfen und Einsatzort speichern.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally { setLocating(false) }
  }

  async function resolveMapLink() {
    if (!form.mapsUrl.trim()) {
      setNotice({ tone: 'error', text: 'Bitte zuerst den kopierten Google-Maps-Link einfügen.' })
      return
    }
    setResolvingMap(true)
    setNotice(null)
    try {
      const result = await apiJson('/api/worksite-v2', {
        method: 'POST',
        body: JSON.stringify({ action: 'resolve-map', url: form.mapsUrl.trim() }),
      })
      setForm((current) => ({
        ...current,
        latitude: Number(result.latitude).toFixed(7),
        longitude: Number(result.longitude).toFixed(7),
      }))
      setNotice({ tone: 'success', text: 'Google-Maps-Pin erkannt. Koordinaten wurden übernommen. Bitte Radius prüfen und speichern.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally { setResolvingMap(false) }
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const payload = { ...form }
      delete payload.mapsUrl
      await apiJson('/api/worksite-v2', { method: 'POST', body: JSON.stringify(payload) })
      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })
      resetForm()
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy(false) }
  }

  async function removeObject(object) {
    if (!object?.id) return
    const confirmed = window.confirm('Einsatzort „' + object.name + '“ wirklich löschen? Alte Dienstpläne bleiben unverändert.')
    if (!confirmed) return
    setBusy(true)
    setNotice(null)
    try {
      await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'object-delete', id: object.id }) })
      if (form.id === object.id) resetForm()
      setNotice({ tone: 'success', text: 'Einsatzort wurde gelöscht. Alte Dienstpläne bleiben unverändert.' })
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy(false) }
  }

  const latitude = Number(form.latitude)
  const longitude = Number(form.longitude)
  const hasPreview = Number.isFinite(latitude) && Number.isFinite(longitude) && form.latitude !== '' && form.longitude !== ''
  const mapQuery = hasPreview ? encodeURIComponent(latitude + ',' + longitude) : ''

  return <>
    <Notice notice={notice} />
    <section className="panel">
      <PageHeader title={form.id ? 'Einsatzort bearbeiten' : 'Einsatzort anlegen'} subtitle="Google-Maps-Pin einfügen, Radius festlegen und speichern. Der Arbeitsbeginn wird nur innerhalb dieses Bereichs erlaubt." />
      <form className="worksite-form" onSubmit={save}>
        <div className="form-grid">
          <label>Name<input value={form.name} onChange={update('name')} required /></label>
          <label>Adresse / Hinweis <span className="optional">optional</span><input value={form.address} onChange={update('address')} placeholder="z. B. Baustelle Nordtor" /></label>
        </div>
        <label>Google-Maps-Link <span className="optional">Pin oder geteilter Link</span>
          <div className="form-actions">
            <input type="url" inputMode="url" value={form.mapsUrl} onChange={update('mapsUrl')} placeholder="https://maps.app.goo.gl/…" />
            <button type="button" className="secondary-button" disabled={busy || locating || resolvingMap} onClick={resolveMapLink}>{resolvingMap ? 'Link wird geprüft …' : 'Standort aus Link übernehmen'}</button>
          </div>
        </label>
        <div className="form-grid three">
          <label>Breitengrad<input inputMode="decimal" value={form.latitude} onChange={update('latitude')} /></label>
          <label>Längengrad<input inputMode="decimal" value={form.longitude} onChange={update('longitude')} /></label>
          <label>Prüfradius in Metern<input type="number" min="0" max="10000" value={form.radiusMeters} onChange={update('radiusMeters')} /></label>
        </div>
        {hasPreview && <div className="worksite-map-preview">
          <iframe title="Vorschau des Einsatzortes" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={'https://www.google.com/maps?q=' + mapQuery + '&z=17&output=embed'} style={{ width: '100%', height: 220, border: 0, borderRadius: 14 }} />
          <p className="muted">Erkannte Position: {latitude.toFixed(6)}, {longitude.toFixed(6)} · Radius {Number(form.radiusMeters || 0)} m</p>
        </div>}
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy || locating || resolvingMap} onClick={captureCurrentLocation}>{locating ? 'Standort wird ermittelt …' : 'Aktuellen Standort übernehmen'}</button>
          <button className="primary-button" disabled={busy || locating || resolvingMap}>{busy ? 'Wird gespeichert …' : 'Einsatzort speichern'}</button>
          {form.id && <button type="button" className="secondary-button" disabled={locating || resolvingMap} onClick={resetForm}>Abbrechen</button>}
        </div>
      </form>
    </section>
    <section className="panel">
      <PageHeader title="Gespeicherte Einsatzorte" subtitle="Arbeitsbeginn wird im eingestellten Radius geprüft. Arbeitsende bleibt auch außerhalb möglich." />
      {objects.length ? <div className="card-list">{objects.map((object) => <article className="worksite-card" key={object.id}>
        <div><strong>{object.name}</strong><span>{object.address || 'Keine Adresse – Position über Koordinaten gespeichert'}</span></div>
        <div><strong>{object.radiusMeters || 500} m</strong><span>Prüfradius</span></div>
        <div className="row-actions">
          <button type="button" className="secondary-button compact" disabled={busy} onClick={() => setForm({ id: object.id, name: object.name, address: object.address || '', mapsUrl: '', latitude: object.latitude ?? '', longitude: object.longitude ?? '', radiusMeters: object.radiusMeters ?? 500 })}>Bearbeiten</button>
          <button type="button" className="danger-outline compact" disabled={busy} onClick={() => removeObject(object)}>Einsatzort löschen</button>
        </div>
      </article>)}</div> : <Empty>Noch keine Einsatzorte gespeichert.</Empty>}
    </section>
  </>
}`

app = app.slice(0, worksiteStart) + worksiteBlock + app.slice(worksiteEnd)

const oldAttendanceSubtitle = `subtitle={employeeOnly ? 'Arbeitsbeginn, Pause und Arbeitsende.' : 'Der Standort wird nur bei Arbeitsbeginn und Arbeitsende abgefragt.'}`
const newAttendanceSubtitle = `subtitle={employeeOnly ? 'Arbeitsbeginn wird am Einsatzort geprüft. Arbeitsende ist auch außerhalb möglich.' : 'Arbeitsbeginn wird am Einsatzort geprüft. Beim Arbeitsende wird der Standort nur als Zusatzinformation erfasst.'}`
if (app.includes(oldAttendanceSubtitle)) app = app.replace(oldAttendanceSubtitle, newAttendanceSubtitle)
assert.ok(app.includes('Standort aus Link übernehmen'), 'Google-Maps-Link-Aktion fehlt nach dem Patch.')
assert.ok(app.includes("action: 'resolve-map'"), 'Google-Maps-Auflösung fehlt nach dem Patch.')
assert.ok(app.includes("try { location = await requestCurrentDeviceLocation() } catch { location = null }"), 'Arbeitsende muss ohne GPS fortgesetzt werden können.')
await writeFile(appPath, app)

for (const schedulePath of ['netlify/functions/schedule-v2-neon.mts', 'netlify/functions/schedule-v2.mts']) {
  let schedule = await readFile(schedulePath, 'utf8')
  const oldValidation = `  if (!name || !address) return json({ message: 'Name und Adresse des Einsatzortes sind erforderlich.' }, 400)`
  const newValidation = `  if (!name) return json({ message: 'Der Name des Einsatzortes ist erforderlich.' }, 400)`
  if (!schedule.includes(newValidation)) {
    assert.ok(schedule.includes(oldValidation), `Adressvalidierung wurde in ${schedulePath} nicht gefunden.`)
    schedule = schedule.replace(oldValidation, newValidation)
    await writeFile(schedulePath, schedule)
  }
}

const worksiteSource = await readFile('netlify/functions/worksite-v2.mts', 'utf8')
assert.ok(worksiteSource.includes("String(body.action || '') === 'resolve-map'"), 'Worksite API muss Google-Maps-Links auflösen können.')
assert.ok(worksiteSource.includes("if (!name) return json({ message: 'Der Name des Einsatzortes ist erforderlich.'"), 'Worksite API muss Einsatzorte ohne postalische Adresse erlauben.')

console.log('Google Maps worksite and robust clock-out feature applied')
