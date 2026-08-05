import type { Config, Context } from '@netlify/functions'
import {
  AttendanceServiceError,
  createAttendanceService,
  eventDateInBerlin,
  normalizeClockRequest,
} from './_shared/attendance-service.mts'
import { createAttendanceRepository } from './_shared/neon-attendance.mts'

type PortalRole = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: PortalRole; status?: string } | null

type ScheduleEntry = {
  id?: string
  employeeUserId?: string
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

export function selectPlannedSchedule(
  entries: ScheduleEntry[],
  userId: string,
  date: string,
  requestedScheduleId: string | null,
) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry.employeeUserId || '') === userId && entry.date === date)
    .sort((left, right) => String(left.start || '').localeCompare(String(right.start || '')))
  if (requestedScheduleId) {
    const requested = candidates.find((entry) => String(entry.id || '') === requestedScheduleId)
    if (requested) return requested
  }
  return candidates[0] || null
}

export function attendanceFunctionMarkers() {
  return {
    verifiesRequestOrigin: true,
    bindsScheduleServerSide: true,
    employeeSelfScope: true,
    liveManagementOnly: true,
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

function databaseUrl() {
  const runtimeValue = typeof Netlify !== 'undefined'
    ? Netlify.env.get('ATTENDANCE_DATABASE_URL')
      || Netlify.env.get('DATABASE_URL')
      || Netlify.env.get('NETLIFY_DATABASE_URL')
    : ''
  return runtimeValue
    || process.env.ATTENDANCE_DATABASE_URL
    || process.env.DATABASE_URL
    || process.env.NETLIFY_DATABASE_URL
    || ''
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

async function loadSchedules(request: Request): Promise<ScheduleEntry[]> {
  try {
    const url = new URL('/api/work?resource=schedule', request.url)
    const scheduleResponse = await fetch(url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'manual',
    })
    if (!scheduleResponse.ok) return []
    const payload = await scheduleResponse.json().catch(() => ({})) as { entries?: ScheduleEntry[] }
    return Array.isArray(payload.entries) ? payload.entries : []
  } catch {
    return []
  }
}

function schedulePayload(entry: ScheduleEntry | null) {
  if (!entry) return null
  return {
    id: entry.id || null,
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

export default async function attendance(request: Request, _context: Context) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!['GET', 'POST'].includes(request.method)) return response({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    const actor = await currentPortalActor()
    if (!actor) return response({ message: 'Nicht angemeldet.', code: 'UNAUTHENTICATED' }, 401)
    if (actor.role === 'pending') {
      return response({ message: 'Das Konto ist noch nicht freigeschaltet.', code: 'ACCOUNT_PENDING' }, 403)
    }

    const connectionString = databaseUrl()
    if (!connectionString) {
      return response({ message: 'Die Zeiterfassungsdatenbank ist noch nicht verbunden.', code: 'DATABASE_NOT_CONFIGURED' }, 503)
    }
    const repository = await createAttendanceRepository(connectionString)
    const service = createAttendanceService({ repository })
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const resource = url.searchParams.get('resource') || 'state'
      if (resource === 'state') {
        const state = await service.getState(actor)
        const schedules = await loadSchedules(request)
        const today = eventDateInBerlin(new Date())
        const requestedScheduleId = url.searchParams.get('scheduleId')
        const schedule = selectPlannedSchedule(schedules, actor.userId, today, requestedScheduleId)
        return response({ ...state, schedule: schedulePayload(schedule) })
      }
      if (resource === 'history') {
        return response(await service.getHistory(actor, {
          userId: url.searchParams.get('userId'),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
        }))
      }
      if (resource === 'live') {
        return response(await service.getLive(actor, {
          date: url.searchParams.get('date'),
          objectId: url.searchParams.get('objectId'),
          userId: url.searchParams.get('userId'),
          status: url.searchParams.get('status'),
        }))
      }
      return response({ message: 'Unbekannter Zeiterfassungsbereich.' }, 400)
    }

    const { verifyRequestOrigin } = await import('@netlify/identity')
    try {
      verifyRequestOrigin(request)
    } catch {
      return response({ message: 'Ungültige Anfragequelle.', code: 'INVALID_ORIGIN' }, 403)
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return response({ message: 'Ungültige Anfrage.' }, 400)
    if (body.resource) return response({ message: 'Diese Aktion ist noch nicht verfügbar.' }, 400)

    const normalized = normalizeClockRequest(body)
    const eventDate = eventDateInBerlin(normalized.clientOccurredAt)
    const schedules = await loadSchedules(request)
    const schedule = selectPlannedSchedule(
      schedules,
      actor.userId,
      eventDate,
      normalized.scheduleId,
    )
    const safeBody = {
      ...body,
      scheduleId: schedule?.id || null,
      objectId: schedule?.objectId || null,
    }
    return response(await service.record(actor, safeBody), 201)
  } catch (error) {
    if (error instanceof AttendanceServiceError) {
      return response({ message: error.message, code: error.code }, error.status)
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return response({ message: error.message, code: 'INVALID_INPUT' }, 400)
    }
    console.error('Habun Attendance V2', error)
    return response({ message: 'Die Zeiterfassung konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance' }
