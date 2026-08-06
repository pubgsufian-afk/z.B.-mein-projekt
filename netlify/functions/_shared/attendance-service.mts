import { createHash } from 'node:crypto'
import { classifyLocation, distanceMetersBetween, validateAttendanceTransition } from './attendance-domain.mts'

const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'manager'])
const VALID_ACTIONS = new Set(['clock-in', 'break-start', 'break-end', 'clock-out'])

export class AttendanceServiceError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'ATTENDANCE_ERROR') {
    super(message)
    this.name = 'AttendanceServiceError'
    this.status = status
    this.code = code
  }
}

function normalizedText(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function validCoordinate(value: unknown, minimum: number, maximum: number) {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null
}

export function eventDateInBerlin(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Ungültiger Buchungszeitpunkt.')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function normalizeClockRequest(body: Record<string, unknown>) {
  const action = String(body?.action || '').trim()
  if (!VALID_ACTIONS.has(action)) throw new AttendanceServiceError('Ungültige Stempelaktion.', 400, 'INVALID_ACTION')
  const clientEventId = String(body?.clientEventId || '').trim()
  if (!clientEventId) throw new AttendanceServiceError('Eine eindeutige Buchungs-ID ist erforderlich.', 400, 'CLIENT_EVENT_ID_REQUIRED')
  const clientOccurredAt = String(body?.clientOccurredAt || '').trim()
  const clientTime = new Date(clientOccurredAt)
  if (!clientOccurredAt || !Number.isFinite(clientTime.getTime())) throw new AttendanceServiceError('Der Buchungszeitpunkt ist ungültig.', 400, 'INVALID_CLIENT_TIME')

  let location = null
  if ((action === 'clock-in' || action === 'clock-out') && body.location && typeof body.location === 'object' && !Array.isArray(body.location)) {
    const raw = body.location as Record<string, unknown>
    const latitude = validCoordinate(raw.latitude, -90, 90)
    const longitude = validCoordinate(raw.longitude, -180, 180)
    const accuracyMeters = Number(raw.accuracyMeters)
    if (latitude !== null && longitude !== null && Number.isFinite(accuracyMeters) && accuracyMeters >= 0) location = { latitude, longitude, accuracyMeters }
  }

  return {
    action,
    clientEventId,
    clientOccurredAt: clientTime.toISOString(),
    scheduleId: normalizedText(body.scheduleId),
    objectId: normalizedText(body.objectId),
    offlineCaptured: Boolean(body.offlineCaptured),
    location,
  }
}

function requestHash(userId: string, payload: ReturnType<typeof normalizeClockRequest>) {
  return createHash('sha256').update(JSON.stringify({ userId, ...payload })).digest('hex')
}

function transitionError(code: string) {
  const messages: Record<string, string> = {
    CLOCK_IN_ALREADY_OPEN: 'Der Arbeitsbeginn wurde bereits erfasst.',
    CLOCK_OUT_WITHOUT_CLOCK_IN: 'Arbeitsende ohne Arbeitsbeginn ist nicht möglich.',
    BREAK_START_WITHOUT_WORK: 'Eine Pause kann nur während einer laufenden Arbeitszeit begonnen werden.',
    BREAK_END_WITHOUT_BREAK: 'Es läuft aktuell keine Pause.',
    BREAK_MUST_END_FIRST: 'Bitte zuerst die laufende Pause beenden.',
    OUT_OF_ORDER_EVENT: 'Die Buchungszeit liegt vor der letzten gespeicherten Aktion.',
  }
  return new AttendanceServiceError(messages[code] || 'Die Reihenfolge der Zeitbuchungen ist unplausibel und muss geprüft werden.', 409, code)
}

function deriveState(events: Array<Record<string, unknown>>) {
  const ordered = [...events].sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))
  let phase = 'idle'
  let clockInAt: unknown = null
  let clockOutAt: unknown = null
  let breakStartedAt: unknown = null
  let breakMinutes = 0

  for (const event of ordered) {
    if (event.action === 'clock-in') {
      phase = 'working'
      clockInAt = event.clientOccurredAt || null
      clockOutAt = null
      breakStartedAt = null
      breakMinutes = 0
    } else if (event.action === 'break-start' && phase === 'working') {
      phase = 'paused'
      breakStartedAt = event.clientOccurredAt || null
    } else if (event.action === 'break-end' && phase === 'paused') {
      if (breakStartedAt) breakMinutes += Math.max(0, Math.round((new Date(String(event.clientOccurredAt)).getTime() - new Date(String(breakStartedAt)).getTime()) / 60000))
      phase = 'working'
      breakStartedAt = null
    } else if (event.action === 'clock-out' && phase === 'working') {
      phase = 'completed'
      clockOutAt = event.clientOccurredAt || null
      breakStartedAt = null
    }
  }

  return { phase, clockInAt, clockOutAt, breakStartedAt, breakMinutes, events: ordered }
}

function requireActor(actor: Record<string, unknown>) {
  const userId = String(actor?.userId || '').trim()
  const email = String(actor?.email || '').trim().toLowerCase()
  const role = String(actor?.role || '').trim()
  if (!userId || !email || !['owner', 'admin', 'manager', 'employee'].includes(role)) throw new AttendanceServiceError('Nicht angemeldet.', 401, 'UNAUTHENTICATED')
  return { userId, email, role }
}

export function createAttendanceService({ repository, now = () => new Date(), randomUUID = crypto.randomUUID.bind(crypto) }) {
  if (!repository) throw new TypeError('Attendance repository is required.')
  return {
    async getState(actor: Record<string, unknown>) {
      const current = requireActor(actor)
      const events = await repository.listEvents(current.userId)
      return deriveState(events)
    },

    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {
      const current = requireActor(actor)
      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')
      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }
    },

    async getLive(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {
      const current = requireActor(actor)
      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')
      return { entries: await repository.listLive({ date: normalizedText(filters.date), objectId: normalizedText(filters.objectId), userId: normalizedText(filters.userId), status: normalizedText(filters.status) }) }
    },

    async record(actor: Record<string, unknown>, rawBody: Record<string, unknown>) {
      const current = requireActor(actor)
      const payload = normalizeClockRequest(rawBody)
      const hash = requestHash(current.userId, payload)
      const existing = await repository.findIdempotency?.(current.userId, payload.clientEventId)
      if (existing) {
        if (existing.requestHash !== hash) throw new AttendanceServiceError('Diese Buchungs-ID wurde bereits mit anderen Daten verwendet.', 409, 'CLIENT_EVENT_ID_CONFLICT')
        return { ...existing.response, replayed: true }
      }

      const events = await repository.listEvents(current.userId)
      const transition = validateAttendanceTransition(events, payload.action)
      if (!transition.ok) throw transitionError(transition.code)

      const boundaryAction = payload.action === 'clock-in' || payload.action === 'clock-out'
      const object = boundaryAction && payload.objectId ? await repository.findObject(payload.objectId) : null
      const configured = Boolean(object && Number.isFinite(Number(object.latitude)) && Number.isFinite(Number(object.longitude)))
      const available = boundaryAction && Boolean(payload.location)
      const distanceMeters = configured && payload.location
        ? distanceMetersBetween(payload.location.latitude, payload.location.longitude, object.latitude, object.longitude)
        : null
      const classification = boundaryAction
        ? classifyLocation(distanceMeters, configured, available, object?.radiusMeters ?? 500)
        : { status: 'unavailable', distanceMeters: null }
      const serverOccurredAt = now().toISOString()
      const eventId = `attendance:${randomUUID()}`
      const effectiveObjectId = boundaryAction ? object?.id || null : payload.objectId
      const event = {
        id: eventId,
        userId: current.userId,
        clientEventId: payload.clientEventId,
        action: payload.action,
        clientOccurredAt: payload.clientOccurredAt,
        serverOccurredAt,
        eventDate: eventDateInBerlin(payload.clientOccurredAt),
        scheduleId: payload.scheduleId,
        objectId: effectiveObjectId,
        locationStatus: classification.status,
        offlineCaptured: payload.offlineCaptured,
      }
      const location = boundaryAction && payload.location
        ? { eventId, userId: current.userId, objectId: effectiveObjectId, capturedAt: payload.clientOccurredAt, ...payload.location, distanceMeters: classification.distanceMeters }
        : null

      const committed = await repository.commitClockEvent({
        userId: current.userId,
        actorEmail: current.email,
        actorRole: current.role,
        clientEventId: payload.clientEventId,
        requestHash: hash,
        event,
        location,
      })
      if (committed.kind === 'conflict') throw new AttendanceServiceError('Diese Buchungs-ID wurde bereits mit anderen Daten verwendet.', 409, 'CLIENT_EVENT_ID_CONFLICT')
      if (committed.kind === 'invalid-transition') throw transitionError(committed.code)
      return committed.response
    },
  }
}
