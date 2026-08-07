import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { admin } from '@netlify/identity'
import { timingSafeEqual } from 'node:crypto'
import {
  findExactScheduleDuplicate,
  listScheduleOverlaps,
  syncScheduleEmployees,
  upsertScheduleShift,
  writeScheduleAudit,
  type ScheduleEmployee,
  type ScheduleShift,
} from './_shared/schedule-neon-repository.mts'
import {
  defaultAssistantLocation,
  resolveAssistantEmployee,
  validateAssistantShiftInput,
  type AssistantDirectoryEmployee,
  type AssistantShiftInput,
} from './_shared/schedule-assistant-core.mts'
import {
  mergeScheduleIdentityDirectory,
  type ScheduleAccessRecord,
  type ScheduleIdentityUser,
} from './_shared/schedule-identity-directory.mts'

type AccessRecord = {
  userId?: string
  role?: string
  status?: string
  fullName?: string
  location?: string
} | null

type PublishInput = AssistantShiftInput & {
  employeeName?: unknown
}

const ACTOR_ID = 'dienstplan-assistent'
const ALLOWED_ROLES = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])
const MAX_BATCH = 100

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function secureTokenMatches(received: string, expected: string) {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  if (!left.length || !right.length || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function ownerEmails() {
  return new Set(
    (Netlify.env.get('PORTAL_OWNER_EMAILS') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

function legacyAccessEmployees(rows: AccessRecord[]): AssistantDirectoryEmployee[] {
  return rows
    .filter((row): row is NonNullable<AccessRecord> => Boolean(
      row?.userId && row.status === 'active' && row.role && ALLOWED_ROLES.has(String(row.role)) && text(row.fullName),
    ))
    .map((row) => ({
      userId: String(row.userId),
      fullName: text(row.fullName),
      role: String(row.role),
      status: 'active',
      location: text(row.location),
    }))
}

async function activePortalEmployees(): Promise<AssistantDirectoryEmployee[]> {
  const store = getStore({ name: 'portal-access', consistency: 'strong' })
  const listed = await store.list({ prefix: 'access/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AccessRecord>),
  )

  let employees: AssistantDirectoryEmployee[] = []
  try {
    const users = await admin.listUsers()
    employees = mergeScheduleIdentityDirectory(
      users as ScheduleIdentityUser[],
      rows.filter((row): row is NonNullable<AccessRecord> => Boolean(row)) as ScheduleAccessRecord[],
      ownerEmails(),
    )
  } catch (error) {
    console.warn('schedule-assistant Identity directory unavailable; using portal-access fallback', error)
  }

  if (!employees.length) employees = legacyAccessEmployees(rows)

  await syncScheduleEmployees(employees.map((employee) => ({
    userId: employee.userId,
    fullName: employee.fullName,
    role: employee.role as ScheduleEmployee['role'],
    status: 'active',
    location: employee.location || '',
  })), true)

  return employees
}

function publicResolution(name: string, employees: AssistantDirectoryEmployee[]) {
  const resolved = resolveAssistantEmployee(name, employees)
  if (resolved.status === 'matched' && resolved.employee) {
    return {
      inputName: name,
      status: 'matched',
      employeeName: resolved.employee.fullName,
      location: defaultAssistantLocation(resolved.employee),
    }
  }
  if (resolved.status === 'ambiguous') {
    return {
      inputName: name,
      status: 'ambiguous',
      candidates: resolved.candidates.map((candidate) => candidate.fullName),
    }
  }
  return { inputName: name, status: 'not_found' }
}

async function publishOne(input: PublishInput, index: number, requestId: string, employees: AssistantDirectoryEmployee[]) {
  const validation = validateAssistantShiftInput(input)
  if (!validation.ok) {
    return { index, employeeName: text(input.employeeName), status: 'invalid', message: validation.message }
  }

  const resolved = resolveAssistantEmployee(input.employeeName, employees)
  if (resolved.status === 'not_found') {
    return { index, employeeName: text(input.employeeName), status: 'not_found' }
  }
  if (resolved.status === 'ambiguous') {
    return {
      index,
      employeeName: text(input.employeeName),
      status: 'ambiguous',
      candidates: resolved.candidates.map((candidate) => candidate.fullName),
    }
  }

  const employee = resolved.employee
  if (!employee) return { index, employeeName: text(input.employeeName), status: 'not_found' }

  const now = new Date().toISOString()
  const location = text(input.location) || defaultAssistantLocation(employee)
  const pauseMinutes = input.pauseMinutes == null || input.pauseMinutes === '' ? 0 : Math.round(Number(input.pauseMinutes))
  const candidate: ScheduleShift = {
    id: crypto.randomUUID(),
    employeeUserId: employee.userId,
    employeeName: employee.fullName,
    date: text(input.date),
    start: text(input.start),
    end: text(input.end),
    pauseMinutes,
    objectId: null,
    location,
    workArea: text(input.workArea),
    note: text(input.note),
    status: 'published',
    version: 1,
    templateId: null,
    repeatGroupId: null,
    createdAt: now,
    createdBy: ACTOR_ID,
    updatedAt: now,
    updatedBy: ACTOR_ID,
    publishedAt: now,
    publishedBy: ACTOR_ID,
    source: 'chatgpt',
    sourceRef: `assistant:${requestId}:${index}`,
  }

  const duplicate = await findExactScheduleDuplicate(candidate)
  if (duplicate) {
    return {
      index,
      employeeName: employee.fullName,
      status: 'duplicate',
      shiftId: duplicate.id,
    }
  }

  const overlaps = await listScheduleOverlaps(candidate)
  try {
    const shift = await upsertScheduleShift(candidate)
    await writeScheduleAudit({
      actorId: 'dienstplan-assistent',
      actorType: 'chatgpt',
      action: 'shift-published',
      shiftId: shift.id,
      details: {
        requestId,
        employeeName: shift.employeeName,
        date: shift.date,
        start: shift.start,
        end: shift.end,
        location: shift.location,
        workArea: shift.workArea,
        pauseMinutes: shift.pauseMinutes,
      },
    })
    return {
      index,
      employeeName: shift.employeeName,
      status: 'published',
      shiftId: shift.id,
      warnings: overlaps.map((entry) => ({
        code: 'OVERLAP',
        shiftId: entry.id,
        date: entry.date,
        start: entry.start,
        end: entry.end,
      })),
    }
  } catch (error) {
    if (String((error as { code?: unknown })?.code || '') === '23505') {
      const concurrentDuplicate = await findExactScheduleDuplicate(candidate)
      if (concurrentDuplicate) {
        return {
          index,
          employeeName: employee.fullName,
          status: 'duplicate',
          shiftId: concurrentDuplicate.id,
        }
      }
    }
    throw error
  }
}

export default async function scheduleAssistant(request: Request, _context: Context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)

  const expectedToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''
  if (!secureTokenMatches(bearerToken(request), expectedToken)) {
    return json({ message: 'Nicht autorisiert.' }, 401)
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

  try {
    const employees = await activePortalEmployees()
    const action = text(body.action)

    if (action === 'resolve-employees') {
      const names = Array.isArray(body.names) ? body.names.map(text).filter(Boolean).slice(0, MAX_BATCH) : []
      if (!names.length) return json({ message: 'Mindestens ein Mitarbeitername ist erforderlich.' }, 400)
      return json({
        integration: 'Dienstplan-Assistent',
        role: 'scheduler',
        results: names.map((name) => publicResolution(name, employees)),
      })
    }

    if (action === 'publish-shifts') {
      const shifts = Array.isArray(body.shifts) ? body.shifts.slice(0, MAX_BATCH) : []
      if (!shifts.length) return json({ message: 'Mindestens ein Dienst ist erforderlich.' }, 400)
      const requestId = text(body.requestId) || crypto.randomUUID()
      const results = []
      for (let index = 0; index < shifts.length; index += 1) {
        const input = shifts[index]
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          results.push({ index, status: 'invalid', message: 'Dienst ist ungültig.' })
          continue
        }
        results.push(await publishOne(input as PublishInput, index, requestId, employees))
      }
      return json({
        integration: 'Dienstplan-Assistent',
        role: 'scheduler',
        requestId,
        results,
      }, 200)
    }

    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    console.error('schedule-assistant failed', error)
    return json({ message: 'Dienstplan konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/schedule-assistant' }
