const AUDIT_KEYS = new Set([
  'action', 'locationStatus', 'offlineCaptured', 'configured', 'radiusMeters', 'eventId', 'pauseMinutes',
  'clientOccurredAt', 'serverOccurredAt', 'clockInAt', 'clockOutAt', 'note', 'scheduleId', 'objectId', 'held',
])

const ACTIONS = new Set(['clock-in', 'break-start', 'break-end', 'clock-out'])

export function distanceMetersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const values = [latitudeA, longitudeA, latitudeB, longitudeB].map(Number)
  if (!values.every(Number.isFinite)) throw new TypeError('Koordinaten müssen gültige Zahlen sein.')
  const [latA, lonA, latB, lonB] = values
  if (Math.abs(latA) > 90 || Math.abs(latB) > 90 || Math.abs(lonA) > 180 || Math.abs(lonB) > 180) throw new RangeError('Koordinaten liegen außerhalb des gültigen Bereichs.')
  if (latA === latB && lonA === lonB) return 0
  const radians = (degrees) => degrees * Math.PI / 180
  const earthRadiusMeters = 6371000
  const deltaLatitude = radians(latB - latA)
  const deltaLongitude = radians(lonB - lonA)
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(deltaLongitude / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function classifyLocation(distanceMeters, configured, available, radiusMeters = 500) {
  const radius = Number.isFinite(Number(radiusMeters)) && Number(radiusMeters) >= 0 ? Number(radiusMeters) : 500
  const distance = distanceMeters === null || distanceMeters === undefined ? null : Number(distanceMeters)
  const hasLocation = Boolean(available) && Number.isFinite(distance)
  const isConfigured = Boolean(configured)
  return {
    status: isConfigured && hasLocation && distance <= radius ? 'inside' : isConfigured && hasLocation ? 'outside' : 'unavailable',
    configured: isConfigured,
    available: hasLocation,
    distanceMeters: hasLocation ? distance : null,
    radiusMeters: radius,
  }
}

export function attendancePhase(events) {
  let phase = 'idle'
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.action === 'clock-in' && (phase === 'idle' || phase === 'completed')) phase = 'working'
    else if (event?.action === 'break-start' && phase === 'working') phase = 'paused'
    else if (event?.action === 'break-end' && phase === 'paused') phase = 'working'
    else if (event?.action === 'clock-out' && phase === 'working') phase = 'completed'
    else return 'invalid'
  }
  return phase
}

export function validateAttendanceTransition(events, action) {
  if (!ACTIONS.has(action)) return { ok: false, code: 'INVALID_ACTION' }
  const phase = attendancePhase(events)
  if (phase === 'invalid') return { ok: false, code: 'INVALID_EXISTING_SEQUENCE' }
  const valid = {
    idle: ['clock-in'],
    working: ['break-start', 'clock-out'],
    paused: ['break-end'],
    completed: ['clock-in'],
  }
  if (valid[phase]?.includes(action)) return { ok: true }
  if (action === 'clock-in') return { ok: false, code: 'CLOCK_IN_ALREADY_OPEN' }
  if (action === 'break-start') return { ok: false, code: 'BREAK_START_WITHOUT_WORK' }
  if (action === 'break-end') return { ok: false, code: 'BREAK_END_WITHOUT_BREAK' }
  if (action === 'clock-out' && phase === 'paused') return { ok: false, code: 'BREAK_MUST_END_FIRST' }
  return { ok: false, code: 'CLOCK_OUT_WITHOUT_CLOCK_IN' }
}

export function calculateNetMinutes(clockInAt, clockOutAt, pauseMinutes) {
  const start = new Date(clockInAt)
  const end = new Date(clockOutAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new TypeError('Arbeitsbeginn und Arbeitsende müssen gültige Zeitpunkte sein.')
  if (end <= start) throw new RangeError('Arbeitsende muss nach dem Arbeitsbeginn liegen.')
  const pause = Number(pauseMinutes)
  if (!Number.isFinite(pause) || pause < 0) throw new RangeError('Pause darf nicht negativ sein.')
  const grossMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
  if (pause >= grossMinutes) throw new RangeError('Pause muss kürzer als die Bruttoarbeitszeit sein.')
  return grossMinutes - Math.round(pause)
}

export function buildIdempotencyKey(userId, clientEventId) {
  const user = String(userId || '').trim()
  const event = String(clientEventId || '').trim()
  if (!user) throw new TypeError('userId ist erforderlich.')
  if (!event) throw new TypeError('clientEventId ist erforderlich.')
  return `${user}:${event}`
}

export function sanitizeAttendanceAuditPayload(payload) {
  const clean = {}
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return clean
  for (const [key, value] of Object.entries(payload)) if (AUDIT_KEYS.has(key) && value !== undefined) clean[key] = value
  return clean
}
