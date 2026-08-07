import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

// 1) Server-side schedule binding: every newly saved shift must use an existing
// saved worksite with coordinates, and the server owns the displayed name.
const schedulePath = 'netlify/functions/schedule-v2.mts'
let scheduleSource = await readFile(schedulePath, 'utf8')

if (!scheduleSource.includes('async function findWorkSite(')) {
  const marker = '\nasync function allShifts()'
  assert.ok(scheduleSource.includes(marker), 'allShifts marker missing in schedule-v2.mts')
  const helper = `
async function findWorkSite(id: string) {
  const normalizedId = String(id || '').trim()
  if (!normalizedId) return null
  return await store().get(\`objects/\${normalizedId}\`, { type: 'json' }) as WorkSite | null
}
`
  scheduleSource = scheduleSource.replace(marker, `${helper}${marker}`)
}

if (!scheduleSource.includes('Einsatzort muss aus den gespeicherten Einsatzorten ausgewählt werden.')) {
  const oldBlock = `async function saveShift(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const existing = body.id ? await findShift(String(body.id)) : null
  const candidate = makeShift(body, current, existing || undefined)`
  assert.ok(scheduleSource.includes(oldBlock), 'saveShift marker missing in schedule-v2.mts')
  const newBlock = `async function saveShift(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const existing = body.id ? await findShift(String(body.id)) : null
  const objectId = String(body.objectId || '').trim()
  if (!objectId) {
    return json({ message: 'Einsatzort muss aus den gespeicherten Einsatzorten ausgewählt werden.', code: 'WORKSITE_REQUIRED' }, 400)
  }
  const object = await findWorkSite(objectId)
  if (!object) {
    return json({ message: 'Der ausgewählte gespeicherte Einsatzort wurde nicht gefunden.', code: 'WORKSITE_NOT_FOUND' }, 404)
  }
  const hasCoordinates = object.latitude !== null && object.longitude !== null
    && Number.isFinite(object.latitude) && Number.isFinite(object.longitude)
  if (!hasCoordinates) {
    return json({ message: 'Einsatzort benötigt gültige Koordinaten für die Standortprüfung.', code: 'WORKSITE_COORDINATES_REQUIRED' }, 400)
  }
  const candidate = makeShift({ ...body, objectId: object.id, location: object.name }, current, existing || undefined)`
  scheduleSource = scheduleSource.replace(oldBlock, newBlock)
}

assert.match(scheduleSource, /async function findWorkSite\(/)
assert.match(scheduleSource, /WORKSITE_REQUIRED/)
assert.match(scheduleSource, /WORKSITE_COORDINATES_REQUIRED/)
assert.match(scheduleSource, /makeShift\(\{ \.\.\.body, objectId: object\.id, location: object\.name \}/)
await writeFile(schedulePath, scheduleSource)

// 2) Unified UI: only saved worksites can be selected. The worksite name is
// shown automatically and cannot diverge from the saved object.
const appPath = 'frontend/src/App.jsx'
let appSource = await readFile(appPath, 'utf8')
const scheduleStart = appSource.indexOf('function SchedulePage({ session }) {')
const scheduleEnd = appSource.indexOf('\nfunction buildSessions', scheduleStart)
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'SchedulePage block missing in App.jsx')
let scheduleBlock = appSource.slice(scheduleStart, scheduleEnd)

if (!scheduleBlock.includes('function selectScheduleObject(event)')) {
  const updateMarker = "  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))"
  assert.ok(scheduleBlock.includes(updateMarker), 'schedule update marker missing in App.jsx')
  scheduleBlock = scheduleBlock.replace(updateMarker, `${updateMarker}\n\n  function selectScheduleObject(event) {\n    const objectId = event.target.value\n    const object = objects.find((item) => item.id === objectId)\n    setForm((current) => ({ ...current, objectId, location: object ? object.name : '' }))\n  }`)
}

scheduleBlock = scheduleBlock
  .replace("const object = objects.find((item) => item.id === form.objectId)\n      const payload = {", "const object = objects.find((item) => item.id === form.objectId)\n      if (!object) throw new Error('Bitte einen gespeicherten Einsatzort auswählen.')\n      const payload = {")
  .replace('objectId: form.objectId || null,', 'objectId: form.objectId,')
  .replace("location: object?.name || form.location,", "location: object?.name || '',")
  .replace("<select value={form.objectId} onChange={update('objectId')}>", '<select value={form.objectId} onChange={selectScheduleObject} required>')
  .replace('<select value={form.objectId} onChange={selectScheduleObject}>', '<select value={form.objectId} onChange={selectScheduleObject} required>')
  .replace('<option value="">Ohne gespeicherten Einsatzort</option>', '<option value="">Gespeicherten Einsatzort wählen</option>')
  .replace("Bezeichnung des Einsatzortes<input value={form.location} onChange={update('location')} required={!form.objectId} />", 'Bezeichnung des Einsatzortes<input value={form.location} readOnly required />')

assert.match(scheduleBlock, /function selectScheduleObject\(event\)/)
assert.match(scheduleBlock, /onChange=\{selectScheduleObject\} required/)
assert.doesNotMatch(scheduleBlock, /Ohne gespeicherten Einsatzort/)
assert.match(scheduleBlock, /Bezeichnung des Einsatzortes<input value=\{form\.location\} readOnly required/)
assert.match(scheduleBlock, /location: object\?\.name \|\| ''/)
appSource = appSource.slice(0, scheduleStart) + scheduleBlock + appSource.slice(scheduleEnd)

// Clear message before the browser request if GPS permission is unavailable.
if (!appSource.includes('Standortfreigabe ist für den Arbeitsbeginn erforderlich.')) {
  const marker = '      const location = needsLocation ? await getLocation() : null\n'
  assert.ok(appSource.includes(marker), 'attendance location marker missing in App.jsx')
  appSource = appSource.replace(marker, `${marker}      if (action === 'clock-in' && !location) throw new Error('Standortfreigabe ist für den Arbeitsbeginn erforderlich.')\n`)
}
await writeFile(appPath, appSource)

// 3) Attendance backend: the server rejects clock-in unless the employee is
// inside the radius of the worksite bound to the published schedule.
const attendancePath = 'netlify/functions/_shared/attendance-service.mts'
let attendanceSource = await readFile(attendancePath, 'utf8')

if (!attendanceSource.includes('CHECK_IN_OUTSIDE_WORKSITE')) {
  const marker = `      const classification = boundaryAction
        ? classifyLocation(distanceMeters, configured, available, object?.radiusMeters ?? 500)
        : { status: 'unavailable', distanceMeters: null }
      const serverOccurredAt = now().toISOString()`
  assert.ok(attendanceSource.includes(marker), 'attendance classification marker missing')
  const replacement = `      const classification = boundaryAction
        ? classifyLocation(distanceMeters, configured, available, object?.radiusMeters ?? 500)
        : { status: 'unavailable', distanceMeters: null }

      if (payload.action === 'clock-in') {
        if (!object) {
          throw new AttendanceServiceError('Für den Arbeitsbeginn ist ein gespeicherter Einsatzort im Dienstplan erforderlich.', 409, 'CHECK_IN_WORKSITE_REQUIRED')
        }
        if (!configured) {
          throw new AttendanceServiceError('Der gespeicherte Einsatzort hat keine gültigen Koordinaten.', 409, 'CHECK_IN_WORKSITE_NOT_CONFIGURED')
        }
        if (!payload.location) {
          throw new AttendanceServiceError('Standortfreigabe ist für den Arbeitsbeginn erforderlich.', 400, 'CHECK_IN_LOCATION_REQUIRED')
        }
        if (classification.status !== 'inside') {
          throw new AttendanceServiceError('Arbeitsbeginn ist nur am vorgesehenen Einsatzort möglich.', 403, 'CHECK_IN_OUTSIDE_WORKSITE')
        }
      }

      const serverOccurredAt = now().toISOString()`
  attendanceSource = attendanceSource.replace(marker, replacement)
}

assert.match(attendanceSource, /CHECK_IN_WORKSITE_REQUIRED/)
assert.match(attendanceSource, /CHECK_IN_LOCATION_REQUIRED/)
assert.match(attendanceSource, /CHECK_IN_OUTSIDE_WORKSITE/)
assert.match(attendanceSource, /classification\.status !== 'inside'/)
await writeFile(attendancePath, attendanceSource)

console.log('Strict saved-worksite selection and check-in enforcement applied')
