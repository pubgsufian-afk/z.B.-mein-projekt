const VALID_ACTIONS = new Set(['clock-in', 'clock-out'])

function normalizedEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Attendance event must be an object.')
  }
  const clientEventId = String(event.clientEventId || '').trim()
  const action = String(event.action || '').trim()
  const clientOccurredAt = String(event.clientOccurredAt || '').trim()
  if (!clientEventId) throw new TypeError('clientEventId is required.')
  if (!VALID_ACTIONS.has(action)) throw new TypeError('Attendance action is invalid.')
  if (!Number.isFinite(new Date(clientOccurredAt).getTime())) {
    throw new TypeError('clientOccurredAt is invalid.')
  }
  return { ...event, clientEventId, action, clientOccurredAt }
}

function fingerprint(event) {
  const location = event.location && typeof event.location === 'object'
    ? {
        latitude: event.location.latitude ?? null,
        longitude: event.location.longitude ?? null,
        accuracyMeters: event.location.accuracyMeters ?? null,
      }
    : null
  return JSON.stringify({
    clientEventId: event.clientEventId,
    action: event.action,
    clientOccurredAt: event.clientOccurredAt,
    offlineCaptured: Boolean(event.offlineCaptured),
    scheduleId: event.scheduleId ?? null,
    objectId: event.objectId ?? null,
    location,
  })
}

export function createClientEventId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof randomUUID !== 'function') throw new Error('Secure random UUID generation is unavailable.')
  return `att:${randomUUID()}`
}

export function enqueueAttendanceEvent(queue, candidate) {
  const event = normalizedEvent(candidate)
  const current = Array.isArray(queue) ? queue : []
  const existing = current.find((item) => item?.clientEventId === event.clientEventId)
  if (!existing) return [...current, event]
  if (fingerprint(normalizedEvent(existing)) !== fingerprint(event)) {
    throw new Error('CLIENT_EVENT_ID_CONFLICT')
  }
  return [...current]
}

export function sortPendingEvents(queue) {
  return [...(Array.isArray(queue) ? queue : [])].sort((left, right) => {
    const timeDifference = new Date(left.clientOccurredAt).getTime() - new Date(right.clientOccurredAt).getTime()
    if (timeDifference) return timeDifference
    return String(left.clientEventId).localeCompare(String(right.clientEventId))
  })
}

export function reduceAttendanceState(state, candidate) {
  const event = normalizedEvent(candidate)
  const current = state && typeof state === 'object'
    ? state
    : { phase: 'idle', clockInAt: null, clockOutAt: null }

  if (event.action === 'clock-in') {
    if (current.phase === 'working') throw new Error('CLOCK_IN_ALREADY_OPEN')
    if (current.phase === 'completed' && current.clockOutAt
      && new Date(event.clientOccurredAt) <= new Date(current.clockOutAt)) {
      throw new Error('CLOCK_IN_BEFORE_PREVIOUS_CLOCK_OUT')
    }
    return {
      phase: 'working',
      clockInAt: event.clientOccurredAt,
      clockOutAt: null,
      lastClientEventId: event.clientEventId,
    }
  }

  if (current.phase !== 'working') throw new Error('CLOCK_OUT_WITHOUT_CLOCK_IN')
  if (new Date(event.clientOccurredAt) <= new Date(current.clockInAt)) {
    throw new Error('CLOCK_OUT_BEFORE_CLOCK_IN')
  }
  return {
    phase: 'completed',
    clockInAt: current.clockInAt,
    clockOutAt: event.clientOccurredAt,
    lastClientEventId: event.clientEventId,
  }
}

export function nextAllowedAction(state) {
  if (state?.phase === 'working') return 'clock-out'
  return 'clock-in'
}

export function attendanceControls(state, flags = {}) {
  const blocked = !flags.restored || Boolean(flags.syncing) || Boolean(flags.submitting)
  if (blocked) return { clockInEnabled: false, clockOutEnabled: false }
  const action = nextAllowedAction(state)
  return {
    clockInEnabled: action === 'clock-in',
    clockOutEnabled: action === 'clock-out',
  }
}

export function shouldRefreshSession(status) {
  return Number(status) === 401
}
