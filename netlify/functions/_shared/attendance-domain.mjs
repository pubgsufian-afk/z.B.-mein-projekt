const AUDIT_KEYS = new Set([
  'action',
  'locationStatus',
  'offlineCaptured',
  'configured',
  'radiusMeters',
  'eventId',
  'pauseMinutes',
  'clientOccurredAt',
  'serverOccurredAt',
  'clockInAt',
  'clockOutAt',
  'note',
  'scheduleId',
  'objectId',
  'held',
])

export function classifyLocation(distanceMeters, configured, available, radiusMeters = 500) {
  const radius = Number.isFinite(Number(radiusMeters)) && Number(radiusMeters) >= 0
    ? Number(radiusMeters)
    : 500
  const distance = distanceMeters === null || distanceMeters === undefined
    ? null
    : Number(distanceMeters)
  const hasLocation = Boolean(available) && Number.isFinite(distance)
  const isConfigured = Boolean(configured)

  return {
    status: isConfigured && hasLocation && distance <= radius
      ? 'inside'
      : isConfigured && hasLocation
        ? 'outside'
        : 'unavailable',
    configured: isConfigured,
    available: hasLocation,
    distanceMeters: hasLocation ? distance : null,
    radiusMeters: radius,
  }
}

export function validateAttendanceTransition(events, action) {
  if (!['clock-in', 'clock-out'].includes(action)) {
    return { ok: false, code: 'INVALID_ACTION' }
  }

  let open = false
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.action === 'clock-in') {
      if (open) return { ok: false, code: 'INVALID_EXISTING_SEQUENCE' }
      open = true
    } else if (event?.action === 'clock-out') {
      if (!open) return { ok: false, code: 'INVALID_EXISTING_SEQUENCE' }
      open = false
    }
  }

  if (action === 'clock-in' && open) return { ok: false, code: 'CLOCK_IN_ALREADY_OPEN' }
  if (action === 'clock-out' && !open) return { ok: false, code: 'CLOCK_OUT_WITHOUT_CLOCK_IN' }
  return { ok: true }
}

export function calculateNetMinutes(clockInAt, clockOutAt, pauseMinutes) {
  const start = new Date(clockInAt)
  const end = new Date(clockOutAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new TypeError('Arbeitsbeginn und Arbeitsende müssen gültige Zeitpunkte sein.')
  }
  if (end <= start) throw new RangeError('Arbeitsende muss nach dem Arbeitsbeginn liegen.')

  const pause = Number(pauseMinutes)
  if (!Number.isFinite(pause) || pause < 0) {
    throw new RangeError('Pause darf nicht negativ sein.')
  }

  const grossMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
  if (pause >= grossMinutes) {
    throw new RangeError('Pause muss kürzer als die Bruttoarbeitszeit sein.')
  }
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
  for (const [key, value] of Object.entries(payload)) {
    if (AUDIT_KEYS.has(key) && value !== undefined) clean[key] = value
  }
  return clean
}
