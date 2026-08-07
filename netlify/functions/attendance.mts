import type { Config, Context } from '@netlify/functions'
import {
  AttendanceServiceError,
  createAttendanceService,
  eventDateInBerlin,
  normalizeClockRequest,
} from './_shared/daily-attendance-service.mts'
import { createAttendanceRepository } from './_shared/neon-attendance.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'

type PortalRole = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: PortalRole; status?: string } | null

type ScheduleEntry = {
  id?: string
  employeeUserId?: string
  employeeName?: string
  date?: string
  start?: string
  end?: string
  location?: string
  workArea?: string
  pauseMinutes?: number
  objectId?: string
  status?: string
}

const VALID_ROLES = new Set<PortalRole>(['owner', 'admin', 'manager', 'employee', 'pending'])
const CLOCKING_EARLY_MINUTES = 60

export function resolvePortalRole({
  email,
  ownerEmails,
  access,
  roles,
}: {
  email: string
  ownerEmails: string[]
  access: AccessRecord
  roles: string[]
}): PortalRole {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const owners = new Set(ownerEmails.map((value) => String(value).trim().toLowerCase()).filter(Boolean))
  if (owners.has(normalizedEmail)) return 'owner'
  if (access?.status === 'active' && access.role && VALID_ROLES.has(access.role)) return access.role
  const metadataRole = roles.find((role) => VALID_ROLES.has(role as PortalRole))
  return (metadataRole as PortalRole) || 'pending'
}

function timeMinutes(value: string | Date | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null
}

function scheduleTime(value: string | undefined) {
  const [hour, minute] = String(value || '').split(':').map(Number)
  return Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? hour * 60 + minute
    : null
}

export function clockingWindowForSchedule(
  entry: ScheduleEntry | null | undefined,
  occurredAt: string | Date | null | undefined,
  earlyMinutes = CLOCKING_EARLY_MINUTES,
) {
  if (!entry) return { allowed: false, code: 'NO_PUBLISHED_SHIFT', opensAtMinute: null, closesAtMinute: null }
  const currentMinute = timeMinutes(occurredAt)
  const start = scheduleTime(entry.start)
  const end = scheduleTime(entry.end)
  const early = Number.isFinite(Number(earlyMinutes)) && Number(earlyMinutes) >= 0 ? Math.round(Number(earlyMinutes)) : CLOCKING_EARLY_MINUTES
  if (currentMinute === null || start === null || end === null) {
    return { allowed: false, code: 'INVALID_SHIFT_WINDOW', opensAtMinute: null, closesAtMinute: null }
  }

  const opensAtMinute = (start - early + 1440) % 1440
  const wrapsMidnight = end < start || start < early
  const allowed = wrapsMidnight
    ? currentMinute >= opensAtMinute || currentMinute <= end
    : currentMinute >= opensAtMinute && currentMinute <= end
  return { allowed, code: allowed ? 'CLOCKING_ALLOWED' : 'OUTSIDE_SHIFT_WINDOW', opensAtMinute, closesAtMinute: end }
}

export function displayAttendancePhase(
  phase: string | null | undefined,
  schedule: ScheduleEntry | null | undefined,
  occurredAt: string | Date | null | undefined,
) {
  if (phase === 'working' || phase === 'paused') return phase
  const window = clockingWindowForSchedule(schedule, occurredAt)
  if (!window.allowed) return 'blocked'
  if (phase === 'completed') return 'idle'
  return phase || 'idle'
}

export function plannedSchedules(entries: ScheduleEntry[], userId: string, date: string) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry.employeeUserId || '') === userId && entry.date === date && entry.status !== 'draft')
    .sort((left, right) => String(left.start || '').localeCompare(String(right.start || '')))
}

export function selectPlannedSchedule(
  entries: ScheduleEntry[],
  userId: string,
  date: string,
  requestedScheduleId: string | null,
  occurredAt: string | Date | null = null,
) {
  const candidates = plannedSchedules(entries, userId, date)
  if (requestedScheduleId) {
    const requested = candidates.find((entry) => String(entry.id || '') === requestedScheduleId)
    if (requested) return requested
  }
  const currentMinute = timeMinutes(occurredAt)
  if (currentMinute === null) return candidates[0] || null
  const active = candidates.find((entry) => {
    const start = scheduleTime(entry.start)
    const end = scheduleTime(entry.end)
    return start !== null && end !== null && currentMinute >= start && currentMinute <= end
  })
  if (active) return active
  const upcoming = candidates.find((entry) => {
    const start = scheduleTime(entry.start)
    return start !== null && start >= currentMinute
  })
  return upcoming || candidates.at(-1) || null
}

export function attendanceFunctionMarkers() {
  return {
    verifiesRequestOrigin: true,
    bindsScheduleServerSide: true,
    employeeSelfScope: true,
    liveManagementOnly: true,
    scheduleV2First: true,
    currentDayScope: true,
    multipleDailyShifts: true,
    enforcesScheduleWindow: true,
    reopensCompletedShift: true,
    requiresInsideWorksite: true,
    clockOutAllowedAfterShiftEnd: true,
  }
}

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'X-Habun-Attendance-Version': 'v2',
    },
  })
}

async function currentPortalActor() {
  const [{ getUser }, { getStore }] = await Promise.all([
    import('@netlify/identity'),
    import('@netlify/blobs'),
  ])
  const user = await getUser()
  if (!user) return null

  const accessStore = getStore({ name: 'portal-access', consistency: 'strong' })
  const access = await accessStore.get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const email = String(user.email || '').trim().toLowerCase()
  const ownerEmails = String(
    typeof Netlify !== 'undefined' ? Netlify.env.get('PORTAL_OWNER_EMAILS') || '' : '',
  ).split(',').map((value) => value.trim()).filter(Boolean)
  const metadataRoles = Array.isArray(user.appMetadata?.roles)
    ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string')
    : []
  const directRole = typeof (user as { role?: unknown }).role === 'string'
    ? [(user as { role: string }).role]
    : []
  const roles = [...new Set([...(user.roles || []), ...metadataRoles, ...directRole])]
  const role = resolvePortalRole({ email, ownerEmails, access, roles })
  return { userId: user.id, email, role }
}

async function loadSchedules(): Promise<ScheduleEntry[]> {
  const { getStore } = await import('@netlify/blobs')
  const scheduleStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await scheduleStore.list({ prefix: 'shifts/' })
  const rows = await Promise.all(listed.blobs.map((blob) => scheduleStore.get(blob.key, { type: 'json' }) as Promise<ScheduleEntry | null>))
  return rows.filter((entry): entry is ScheduleEntry => Boolean(entry))
}

function schedulePayload(entry: ScheduleEntry | null) {
  if (!entry) return null
  return {
    id: entry.id || null,
    employeeName: entry.employeeName || '',
    date: entry.date || null,
    start: entry.start || null,
    end: entry.end || null,
    location: entry.location || '',
    workArea: entry.workArea || '',
    pauseMinutes: Number.isFinite(Number(entry.pauseMinutes)) ? Number(entry.pauseMinutes) : 0,
    objectId: entry.objectId || null,
    status: entry.status || 'published',
  }
}

function enrichLiveEntries(entries: Array<Record<string, unknown>>, schedules: ScheduleEntry[]) {
  return entries.map((entry) => {
    const schedule = selectPlannedSchedule(
      schedules,
      String(entry.userId || ''),
      String(entry.eventDate || ''),
      String(entry.scheduleId || '') || null,
      String(entry.clientOccurredAt || ''),
    )
    return {
      ...entry,
      employeeName: schedule?.employeeName || String(entry.userId || ''),
      workSiteName: schedule?.location || '',
      workArea: schedule?.workArea || '',
      pauseMinutes: Number(schedule?.pauseMinutes || 0),
      plannedStart: schedule?.start || null,
      plannedEnd: schedule?.end || null,
    }
  })
}

function clockingDeniedError(window: ReturnType<typeof clockingWindowForSchedule>) {
  if (window.code === 'NO_PUBLISHED_SHIFT') {
    return new AttendanceServiceError(
      'Für heute ist kein freigegebener Dienst hinterlegt. Eine Zeitbuchung ist deshalb nicht möglich.',
      403,
      'NO_PUBLISHED_SHIFT',
    )
  }
  return new AttendanceServiceError(
    'Der Arbeitsbeginn ist erst eine Stunde vor Dienstbeginn bis zum geplanten Dienstende möglich.',
    403,
    'OUTSIDE_SHIFT_WINDOW',
  )
}

export default async function attendance(request: Request, _context: Context) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!['GET', 'POST'].includes(request.method)) return response({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    const actor = await currentPortalActor()
    if (!actor) return response({ message: 'Nicht angemeldet.', code: 'UNAUTHENTICATED' }, 401)
    if (actor.role === 'pending') return response({ message: 'Das Konto ist noch nicht freigeschaltet.', code: 'ACCOUNT_PENDING' }, 403)

    const connectionString = databaseConnectionString()
    if (!connectionString) return response({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.', code: 'DATABASE_NOT_CONFIGURED' }, 503)
    const repository = await createAttendanceRepository(connectionString)
    const service = createAttendanceService({ repository })
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const resource = url.searchParams.get('resource') || 'state'
      if (resource === 'state') {
        const state = await service.getState(actor)
        const schedules = await loadSchedules()
        const now = new Date()
        const today = eventDateInBerlin(now)
        const requestedScheduleId = url.searchParams.get('scheduleId')
        const candidates = plannedSchedules(schedules, actor.userId, today)
        const schedule = selectPlannedSchedule(schedules, actor.userId, today, requestedScheduleId, now)
        const clocking = clockingWindowForSchedule(schedule, now)
        const visiblePhase = displayAttendancePhase(state.phase, schedule, now)
        if (actor.role === 'employee') {
          return response({
            phase: visiblePhase,
            rawPhase: state.phase,
            schedule: schedulePayload(schedule),
            clocking,
          })
        }
        return response({
          ...state,
          phase: visiblePhase,
          rawPhase: state.phase,
          schedule: schedulePayload(schedule),
          schedules: candidates.map((entry) => schedulePayload(entry)),
          clocking,
        })
      }
      if (resource === 'history') {
        if (actor.role === 'employee') return response({ message: 'Keine Berechtigung.', code: 'FORBIDDEN' }, 403)
        return response(await service.getHistory(actor, {
          userId: url.searchParams.get('userId'),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
        }))
      }
      if (resource === 'live') {
        const result = await service.getLive(actor, {
          date: url.searchParams.get('date'),
          objectId: url.searchParams.get('objectId'),
          userId: url.searchParams.get('userId'),
          status: url.searchParams.get('status'),
        })
        const schedules = await loadSchedules()
        return response({ entries: enrichLiveEntries(result.entries, schedules) })
      }
      return response({ message: 'Unbekannter Zeiterfassungsbereich.' }, 400)
    }

    const { verifyRequestOrigin } = await import('@netlify/identity')
    try { verifyRequestOrigin(request) } catch { return response({ message: 'Ungültige Anfragequelle.', code: 'INVALID_ORIGIN' }, 403) }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return response({ message: 'Ungültige Anfrage.' }, 400)
    if (body.resource) return response({ message: 'Diese Aktion ist noch nicht verfügbar.' }, 400)

    const normalized = normalizeClockRequest(body)
    const serverNow = new Date()
    const eventDate = eventDateInBerlin(serverNow)
    const schedules = await loadSchedules()
    const schedule = selectPlannedSchedule(schedules, actor.userId, eventDate, normalized.scheduleId, serverNow)
    if (normalized.action === 'clock-in') {
      const window = clockingWindowForSchedule(schedule, serverNow)
      if (!window.allowed) throw clockingDeniedError(window)
    }
    const safeBody = { ...body, scheduleId: schedule?.id || null, objectId: schedule?.objectId || null }
    const recorded = await service.record(actor, safeBody)
    return response(actor.role === 'employee' ? { saved: true, action: normalized.action } : recorded, 201)
  } catch (error) {
    if (error instanceof AttendanceServiceError) return response({ message: error.message, code: error.code }, error.status)
    if (error instanceof TypeError || error instanceof RangeError) return response({ message: error.message, code: 'INVALID_INPUT' }, 400)
    console.error('Habun Attendance V2', error)
    return response({ message: 'Die Zeiterfassung konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance' }
