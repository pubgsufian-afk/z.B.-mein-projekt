import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
let changed = false

const actionLabelMarker = `function actionLabel(action) {
  return action === 'clock-in' ? 'Arbeitsbeginn' : action === 'break-start' ? 'Pause begonnen' : action === 'break-end' ? 'Pause beendet' : 'Arbeitsende'
}
`

const helper = `
function requestCurrentDeviceLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Die Standortabfrage wird auf diesem Gerät oder Browser nicht unterstützt.')
  }
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
    }),
    (error) => {
      const message = error?.code === 1
        ? 'Standortzugriff wurde nicht erlaubt. Bitte die Standortfreigabe für diese Webseite zulassen und erneut versuchen.'
        : error?.code === 2
          ? 'Der aktuelle Standort konnte von diesem Gerät nicht ermittelt werden. Bitte die Standortdienste prüfen und erneut versuchen.'
          : 'Die Standortabfrage hat zu lange gedauert. Bitte erneut versuchen.'
      reject(new Error(message))
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  ))
}
`

if (!source.includes('function requestCurrentDeviceLocation()')) {
  assert.ok(source.includes(actionLabelMarker), 'Marker für die gemeinsame Standortfunktion fehlt.')
  source = source.replace(actionLabelMarker, `${actionLabelMarker}${helper}`)
  changed = true
}

if (source.includes('async function getLocation()')) {
  const localLocationFunction = /\n  async function getLocation\(\) \{[\s\S]*?\n  \}\n\n  async function record\(action\) \{/
  assert.match(source, localLocationFunction, 'Lokale Standortfunktion der Zeiterfassung konnte nicht gefunden werden.')
  source = source.replace(localLocationFunction, '\n\n  async function record(action) {')
  changed = true
}

const oldAttendanceCall = `const location = needsLocation ? await getLocation() : null`
const newAttendanceCall = `const location = needsLocation ? await requestCurrentDeviceLocation() : null`
if (!source.includes(newAttendanceCall)) {
  assert.ok(source.includes(oldAttendanceCall), 'Standortaufruf der Zeiterfassung fehlt.')
  source = source.replace(oldAttendanceCall, newAttendanceCall)
  changed = true
}

const captureFunction = /  async function captureCurrentLocation\(\) \{[\s\S]*?\n  \}\n\n  async function save\(event\) \{/
if (captureFunction.test(source) && !source.includes('const location = await requestCurrentDeviceLocation()')) {
  source = source.replace(captureFunction, `  async function captureCurrentLocation() {
    setLocating(true)
    setNotice(null)
    try {
      const location = await requestCurrentDeviceLocation()
      setForm((current) => ({
        ...current,
        latitude: location.latitude.toFixed(7),
        longitude: location.longitude.toFixed(7),
      }))
      setNotice({ tone: 'success', text: \`Aktueller Standort übernommen (Genauigkeit ca. \${Math.round(location.accuracyMeters || 0)} m). Bitte Einsatzort speichern.\` })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally { setLocating(false) }
  }

  async function save(event) {`)
  changed = true
}

assert.ok(source.includes('function requestCurrentDeviceLocation()'), 'Gemeinsame Standortfunktion fehlt nach dem Patch.')
assert.ok(source.includes(newAttendanceCall), 'Zeiterfassung nutzt die gemeinsame Standortfunktion nicht.')
assert.ok(source.includes('const location = await requestCurrentDeviceLocation()'), 'Einsatzort-Verwaltung nutzt die gemeinsame Standortfunktion nicht.')

if (changed) await writeFile(path, source)
console.log(changed ? 'Device-independent geolocation fix applied' : 'Device-independent geolocation fix already applied')
