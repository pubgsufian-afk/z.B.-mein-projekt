import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { admin } from '@netlify/identity'
import { timingSafeEqual } from 'node:crypto'
import {
  deleteScheduleShift,
  findExactScheduleDuplicate,
  findScheduleShift,
  listScheduleShifts,
  syncScheduleEmployees,
  upsertScheduleShift,
  writeScheduleAudit,
  type ScheduleEmployee,
  type ScheduleShift,
} from './_shared/schedule-neon-repository.mts'
import {
  assistantPersonMatch,
  classifyAssistantDuplicate,
  defaultAssistantLocation,
  normalizeAssistantName,
  resolveAssistantEmployee,
  resolveAssistantWorksite,
  validateAssistantShiftInput,
  type AssistantDirectoryEmployee,
  type AssistantShiftInput,
  type AssistantWorksite,
} from './_shared/schedule-assistant-core.mts'
import {
  isProvisionalEmployeeUserId,
  provisionalEmployeeUserId,
} from './_shared/schedule-provisional-employee.mts'
import { ensureLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'
import {
  combineScheduleAccessRows,
  mergeScheduleIdentityDirectory,
  requestedScheduleIdentityFallback,
  type ScheduleAccessRecord,
  type ScheduleIdentityUser,
  type ScheduleRegistrationRecord,
} from './_shared/schedule-identity-directory.mts'

type PublishInput = AssistantShiftInput & {
  employeeName?: unknown
}

type DirectoryDiagnostics = {
  identityUserCount: number
  accessCount: number
  registrationCount: number
  combinedAccessCount: number
  employeeCount: number
  requestedCount: number
  identityLookupSucceeded: boolean
}

type ActivePortalDirectory = {
  employees: AssistantDirectoryEmployee[]
  directoryDiagnostics: DirectoryDiagnostics
}

const ACTOR_ID = 'dienstplan-assistent'
const ALLOWED_ROLES = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])
const MAX_BATCH = 100
const MAX_LIST_RESULTS = 500
const MAX_RANGE_DAYS = 62
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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

function legacyAccessEmployees(rows: ScheduleAccessRecord[]): AssistantDirectoryEmployee[] {
  return rows
    .filter((row) => Boolean(
      text(row.userId) && text(row.status) === 'active' && ALLOWED_ROLES.has(text(row.role)) && text(row.fullName),
    ))
    .map((row) => ({
      userId: text(row.userId),
      fullName: text(row.fullName),
      role: text(row.role),
      status: 'active',
      location: text(row.location),
    }))
}

async function activePortalEmployees(requestedNames: string[] = []): Promise<ActivePortalDirectory> {
  let accessRows: ScheduleAccessRecord[] = []
  try {
    const accessStore = getStore({ name: 'portal-access', consistency: 'strong' })
    const accessListed = await accessStore.list({ prefix: 'access/' })
    const rawAccessRows = await Promise.all(
      accessListed.blobs.map((blob) => accessStore.get(blob.key, { type: 'json' }) as Promise<ScheduleAccessRecord | null>),
    )
    accessRows = rawAccessRows.filter((row): row is ScheduleAccessRecord => Boolean(row))
  } catch (error) {
    console.warn('schedule-assistant portal-access unavailable; continuing with Identity', error)
  }

  let registrations: ScheduleRegistrationRecord[] = []
  try {
    const registrationStore = getStore({ name: 'portal-registrations', consistency: 'strong' })
    const registrationListed = await registrationStore.list({ prefix: 'registration/' })
    const rawRegistrations = await Promise.all(
      registrationListed.blobs.map((blob) => registrationStore.get(blob.key, { type: 'json' }) as Promise<ScheduleRegistrationRecord | null>),
    )
    registrations = rawRegistrations.filter((row): row is ScheduleRegistrationRecord => Boolean(row))
  } catch (error) {
    console.warn('schedule-assistant portal-registrations unavailable; continuing with Identity', error)
  }

  const combinedAccess = combineScheduleAccessRows(accessRows, registrations)
  const owners = ownerEmails()

  let identityUsers: ScheduleIdentityUser[] = []
  let identityLookupSucceeded = false
  let employees: AssistantDirectoryEmployee[] = []
  try {
    identityUsers = await admin.listUsers() as ScheduleIdentityUser[]
    identityLookupSucceeded = true
    employees = mergeScheduleIdentityDirectory(identityUsers, combinedAccess, owners)
  } catch (error) {
    console.warn('schedule-assistant Identity directory unavailable; using approved registration fallback', error)
  }

  if (!employees.length) employees = legacyAccessEmployees(combinedAccess)

  const requestedFallback = requestedScheduleIdentityFallback(
    identityUsers,
    combinedAccess,
    owners,
    requestedNames,
  )
  const byUserId = new Map(employees.map((employee) => [employee.userId, employee]))
  for (const employee of requestedFallback) {
    if (!byUserId.has(employee.userId)) byUserId.set(employee.userId, employee)
  }
  employees = [...byUserId.values()].sort((left, right) => left.fullName.localeCompare(right.fullName, 'de'))

  const directoryDiagnostics: DirectoryDiagnostics = {
    identityUserCount: identityUsers.length,
    accessCount: accessRows.length,
    registrationCount: registrations.length,
    combinedAccessCount: combinedAccess.length,
    employeeCount: employees.length,
    requestedCount: requestedNames.length,
    identityLookupSucceeded,
  }

  if (requestedNames.length) {
    await writeScheduleAudit({
      actorId: ACTOR_ID,
      actorType: 'chatgpt',
      action: 'directory-diagnostics',
      details: directoryDiagnostics,
    })
  }

  await syncScheduleEmployees(employees.map((employee) => ({
    userId: employee.userId,
    fullName: employee.fullName,
    role: employee.role as ScheduleEmployee['role'],
    status: 'active',
    location: employee.location || '',
  })), true)

  return { employees, directoryDiagnostics }
}

async function activePortalWorksites(): Promise<AssistantWorksite[]> {
  try {
    const worksiteStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
    const listed = await worksiteStore.list({ prefix: 'objects/' })
    const rows = await Promise.all(
      listed.blobs.map((blob) => worksiteStore.get(blob.key, { type: 'json' }) as Promise<AssistantWorksite | null>),
    )
    return rows.filter((row): row is AssistantWorksite => Boolean(row))
  } catch (error) {
    console.error('schedule-assistant worksites unavailable', error)
    throw new Error('Gespeicherte Einsatzorte konnten nicht geladen werden.')
  }
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

function publicShift(shift: ScheduleShift) {
  return {
    id: shift.id,
    employeeUserId: shift.employeeUserId,
    employeeName: shift.employeeName,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    pauseMinutes: shift.pauseMinutes,
    objectId: shift.objectId,
    location: shift.location,
    workArea: shift.workArea,
    note: shift.note,
    status: shift.status,
    version: shift.version,
    source: shift.source,
    sourceRef: shift.sourceRef,
    updatedAt: shift.updatedAt,
    publishedAt: shift.publishedAt,
  }
}

function auditShift(shift: ScheduleShift) {
  return {
    employeeUserId: shift.employeeUserId,
    employeeName: shift.employeeName,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    pauseMinutes: shift.pauseMinutes,
    location: shift.location,
    workArea: shift.workArea,
    note: shift.note,
    status: shift.status,
    source: shift.source,
  }
}

function parseRange(body: Record<string, unknown>, required = true) {
  const from = text(body.from)
  const to = text(body.to)
  if (!from && !to && !required) return { ok: true as const, from: '', to: '' }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { ok: false as const, message: 'Zeitraum ist ungültig.' }
  }
  if (to < from) return { ok: false as const, message: 'Zeitraum ist ungültig.' }
  const fromMs = Date.parse(`${from}T12:00:00Z`)
  const toMs = Date.parse(`${to}T12:00:00Z`)
  if ((toMs - fromMs) / 86400000 > MAX_RANGE_DAYS) {
    return { ok: false as const, message: `Zeitraum darf höchstens ${MAX_RANGE_DAYS + 1} Tage umfassen.` }
  }
  return { ok: true as const, from, to }
}

function filterByResolvedEmployee(
  entries: ScheduleShift[],
  employeeName: string,
  employeeUserId: string,
  employees: AssistantDirectoryEmployee[],
) {
  if (employeeUserId) return { status: 'matched' as const, entries: entries.filter((entry) => entry.employeeUserId === employeeUserId) }
  if (!employeeName) return { status: 'matched' as const, entries }

  const resolved = resolveAssistantEmployee(employeeName, employees)
  if (resolved.status === 'ambiguous') {
    return { status: 'ambiguous' as const, entries: [] as ScheduleShift[], candidates: resolved.candidates.map((candidate) => candidate.fullName) }
  }
  if (resolved.status === 'not_found' || !resolved.employee) {
    return { status: 'not_found' as const, entries: [] as ScheduleShift[], candidates: [] as string[] }
  }

  const probe = { employeeUserId: resolved.employee.userId, employeeName: resolved.employee.fullName }
  return {
    status: 'matched' as const,
    entries: entries.filter((entry) => assistantPersonMatch(probe, entry, employees).status === 'same'),
  }
}

async function listAssistantShifts(body: Record<string, unknown>, employees: AssistantDirectoryEmployee[]) {
  const range = parseRange(body)
  if (!range.ok) return json({ message: range.message, code: 'INVALID_RANGE' }, 400)

  const status = text(body.status)
  if (status && !['draft', 'published'].includes(status)) {
    return json({ message: 'Dienstplanstatus ist ungültig.', code: 'INVALID_STATUS' }, 400)
  }

  let entries = await listScheduleShifts({
    from: range.from,
    to: range.to,
    publishedOnly: status === 'published',
  })
  if (status === 'draft') entries = entries.filter((entry) => entry.status === 'draft')

  const filtered = filterByResolvedEmployee(entries, text(body.employeeName), text(body.employeeUserId), employees)
  if (filtered.status === 'ambiguous') {
    return json({ message: 'Mitarbeitername ist nicht eindeutig.', code: 'AMBIGUOUS_EMPLOYEE', candidates: filtered.candidates }, 409)
  }
  if (filtered.status === 'not_found') {
    return json({ entries: [], count: 0 })
  }

  entries = filtered.entries
  const requestedLocation = normalizeAssistantName(body.location)
  if (requestedLocation) {
    entries = entries.filter((entry) => normalizeAssistantName(entry.location) === requestedLocation)
  }

  const limited = entries.slice(0, MAX_LIST_RESULTS)
  return json({
    entries: limited.map(publicShift),
    count: limited.length,
    truncated: entries.length > limited.length,
  })
}

async function findAssistantDuplicates(body: Record<string, unknown>, employees: AssistantDirectoryEmployee[]) {
  const range = parseRange(body)
  if (!range.ok) return json({ message: range.message, code: 'INVALID_RANGE' }, 400)

  let entries = await listScheduleShifts({ from: range.from, to: range.to })
  const filtered = filterByResolvedEmployee(entries, text(body.employeeName), text(body.employeeUserId), employees)
  if (filtered.status === 'ambiguous') {
    return json({ message: 'Mitarbeitername ist nicht eindeutig.', code: 'AMBIGUOUS_EMPLOYEE', candidates: filtered.candidates }, 409)
  }
  entries = filtered.entries

  const duplicates: Array<Record<string, unknown>> = []
  const ambiguous: Array<Record<string, unknown>> = []
  for (let index = 0; index < entries.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
      const left = entries[index]
      const right = entries[otherIndex]
      if (left.date !== right.date) continue
      const classified = classifyAssistantDuplicate(left, [right], employees)
      if (classified.exact) {
        duplicates.push({ type: 'exact', left: publicShift(left), right: publicShift(right) })
      } else if (classified.time) {
        duplicates.push({ type: 'time', left: publicShift(left), right: publicShift(right) })
      } else if (classified.overlaps.length) {
        duplicates.push({ type: 'overlap', left: publicShift(left), right: publicShift(right) })
      } else if (classified.ambiguous.length) {
        ambiguous.push({ left: publicShift(left), right: publicShift(right) })
      }
    }
  }
  return json({ duplicates, ambiguous, count: duplicates.length })
}

async function publishOne(
  input: PublishInput,
  index: number,
  requestId: string,
  employees: AssistantDirectoryEmployee[],
  worksites: AssistantWorksite[],
  allowUnregistered: boolean,
) {
  const validation = validateAssistantShiftInput(input)
  if (!validation.ok) {
    return { index, employeeName: text(input.employeeName), status: 'invalid', message: validation.message }
  }

  const resolved = resolveAssistantEmployee(input.employeeName, employees)
  if (resolved.status === 'ambiguous') {
    return {
      index,
      employeeName: text(input.employeeName),
      status: 'ambiguous',
      candidates: resolved.candidates.map((candidate) => candidate.fullName),
    }
  }

  let employee: { userId: string; fullName: string }
  if (resolved.status === 'matched' && resolved.employee) {
    employee = resolved.employee
  } else if (allowUnregistered && resolved.status === 'not_found') {
    const fullName = text(input.employeeName)
    const userId = provisionalEmployeeUserId(fullName)
    if (!userId) {
      return { index, employeeName: fullName, status: 'invalid', message: 'Mitarbeitername fehlt.' }
    }
    employee = { userId, fullName }
  } else {
    return { index, employeeName: text(input.employeeName), status: 'not_found' }
  }

  const resolvedWorksite = resolveAssistantWorksite(input.location, worksites)
  if (resolvedWorksite.status === 'not_found') {
    return { index, employeeName: employee.fullName, status: 'location_not_found', location: text(input.location) }
  }
  if (resolvedWorksite.status === 'ambiguous') {
    return {
      index,
      employeeName: employee.fullName,
      status: 'location_ambiguous',
      location: text(input.location),
      candidates: resolvedWorksite.candidates.map((candidate) => text(candidate.name)),
    }
  }
  if (resolvedWorksite.status === 'unconfigured') {
    return { index, employeeName: employee.fullName, status: 'location_unconfigured', location: text(input.location) }
  }

  const worksite = resolvedWorksite.worksite
  if (!worksite) {
    return { index, employeeName: employee.fullName, status: 'location_not_found', location: text(input.location) }
  }

  const now = new Date().toISOString()
  const pauseMinutes = input.pauseMinutes == null || input.pauseMinutes === '' ? 0 : Math.round(Number(input.pauseMinutes))
  const candidate: ScheduleShift = {
    id: crypto.randomUUID(),
    employeeUserId: employee.userId,
    employeeName: employee.fullName,
    date: text(input.date),
    start: text(input.start),
    end: text(input.end),
    pauseMinutes,
    objectId: text(worksite.id),
    location: text(worksite.name),
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

  const dateShifts = await listScheduleShifts({ from: candidate.date, to: candidate.date })
  const classified = classifyAssistantDuplicate(candidate, dateShifts, employees)
  if (classified.exact) {
    return { index, employeeName: employee.fullName, status: 'duplicate', shiftId: classified.exact.id }
  }
  if (classified.time) {
    return { index, employeeName: employee.fullName, status: 'time_conflict', shiftId: classified.time.id }
  }

  try {
    const shift = await upsertScheduleShift(candidate)
    await writeScheduleAudit({
      actorId: ACTOR_ID,
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
        provisionalEmployee: isProvisionalEmployeeUserId(shift.employeeUserId),
      },
    })
    return {
      index,
      employeeName: shift.employeeName,
      status: 'published',
      shiftId: shift.id,
      warnings: classified.overlaps.map((entry) => ({
        code: 'OVERLAP',
        shiftId: text(entry.id),
        date: text(entry.date),
        start: text(entry.start),
        end: text(entry.end),
      })),
    }
  } catch (error) {
    if (String((error as { code?: unknown })?.code || '') === '23505') {
      const concurrentDuplicate = await findExactScheduleDuplicate(candidate)
      if (concurrentDuplicate) {
        return { index, employeeName: employee.fullName, status: 'duplicate', shiftId: concurrentDuplicate.id }
      }
    }
    throw error
  }
}

async function updateAssistantShift(
  body: Record<string, unknown>,
  employees: AssistantDirectoryEmployee[],
  requestId: string,
) {
  const shiftId = text(body.shiftId)
  if (!shiftId) return json({ message: 'Dienst-ID fehlt.', code: 'SHIFT_ID_REQUIRED' }, 400)
  const existing = await findScheduleShift(shiftId)
  if (!existing) return json({ message: 'Dienst nicht gefunden.', code: 'NOT_FOUND' }, 404)

  const rawChanges = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
    ? body.changes as Record<string, unknown>
    : body
  let employeeUserId = existing.employeeUserId
  let employeeName = existing.employeeName
  if (text(rawChanges.employeeName)) {
    const resolved = resolveAssistantEmployee(rawChanges.employeeName, employees)
    if (resolved.status === 'ambiguous') {
      return json({ message: 'Mitarbeitername ist nicht eindeutig.', code: 'AMBIGUOUS_EMPLOYEE', candidates: resolved.candidates.map((candidate) => candidate.fullName) }, 409)
    }
    if (resolved.status === 'not_found' || !resolved.employee) {
      return json({ message: 'Mitarbeiter wurde nicht gefunden.', code: 'EMPLOYEE_NOT_FOUND' }, 404)
    }
    employeeUserId = resolved.employee.userId
    employeeName = resolved.employee.fullName
  }

  let objectId = existing.objectId
  let location = existing.location
  if (text(rawChanges.location)) {
    const worksites = await activePortalWorksites()
    const resolvedWorksite = resolveAssistantWorksite(rawChanges.location, worksites)
    if (resolvedWorksite.status !== 'matched' || !resolvedWorksite.worksite) {
      return json({ message: 'Einsatzort konnte nicht eindeutig aufgelöst werden.', code: `LOCATION_${resolvedWorksite.status.toUpperCase()}` }, 409)
    }
    objectId = text(resolvedWorksite.worksite.id)
    location = text(resolvedWorksite.worksite.name)
  }

  const now = new Date().toISOString()
  const candidate: ScheduleShift = {
    ...existing,
    employeeUserId,
    employeeName,
    date: text(rawChanges.date) || existing.date,
    start: text(rawChanges.start) || existing.start,
    end: text(rawChanges.end) || existing.end,
    pauseMinutes: rawChanges.pauseMinutes == null || rawChanges.pauseMinutes === ''
      ? existing.pauseMinutes
      : Math.round(Number(rawChanges.pauseMinutes)),
    objectId,
    location,
    workArea: text(rawChanges.workArea) || existing.workArea,
    note: rawChanges.note == null ? existing.note : text(rawChanges.note),
    updatedAt: now,
    updatedBy: ACTOR_ID,
  }

  const validation = validateAssistantShiftInput(candidate)
  if (!validation.ok) return json({ message: validation.message, code: 'INVALID_SHIFT' }, 400)

  const dateShifts = (await listScheduleShifts({ from: candidate.date, to: candidate.date }))
    .filter((entry) => entry.id !== candidate.id)
  const classified = classifyAssistantDuplicate(candidate, dateShifts, employees)
  if (classified.exact) {
    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE', shiftId: classified.exact.id }, 409)
  }
  if (classified.time) {
    return json({ message: 'Für diesen Mitarbeiter existiert zur selben Zeit bereits ein Dienst.', code: 'TIME_DUPLICATE', shiftId: classified.time.id }, 409)
  }

  await upsertScheduleShift(candidate)
  await writeScheduleAudit({
    actorId: ACTOR_ID,
    actorType: 'chatgpt',
    action: 'shift-updated',
    shiftId: candidate.id,
    details: { requestId, before: auditShift(existing), after: auditShift(candidate) },
  })
  const verified = await findScheduleShift(candidate.id)
  if (!verified) return json({ message: 'Geänderter Dienst konnte nicht verifiziert werden.', code: 'VERIFY_FAILED' }, 500)
  return json({
    shift: publicShift(verified),
    warnings: classified.overlaps.map((entry) => ({
      code: 'OVERLAP',
      shiftId: text(entry.id),
      date: text(entry.date),
      start: text(entry.start),
      end: text(entry.end),
    })),
  })
}

async function deleteAssistantShift(body: Record<string, unknown>, requestId: string) {
  const shiftId = text(body.shiftId)
  if (!shiftId) return json({ message: 'Dienst-ID fehlt.', code: 'SHIFT_ID_REQUIRED' }, 400)
  const existing = await findScheduleShift(shiftId)
  if (!existing) return json({ message: 'Dienst nicht gefunden.', code: 'NOT_FOUND' }, 404)

  const deleted = await deleteScheduleShift(shiftId)
  if (!deleted) return json({ message: 'Dienst konnte nicht gelöscht werden.', code: 'DELETE_FAILED' }, 500)
  await writeScheduleAudit({
    actorId: ACTOR_ID,
    actorType: 'chatgpt',
    action: 'shift-deleted',
    shiftId,
    details: { requestId, before: auditShift(existing) },
  })
  return json({ deleted: true, id: shiftId })
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
    await ensureLegacyScheduleMigrated()
  } catch (error) {
    console.error('schedule-assistant database bootstrap failed', error)
    return json({ message: 'Der Dienstplan-Speicher konnte nicht vorbereitet werden.', code: 'SCHEDULE_DATABASE_BOOTSTRAP_FAILED' }, 503)
  }

  try {
    const changes = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
      ? body.changes as Record<string, unknown>
      : {}
    const requestedNames = [
      ...(Array.isArray(body.names) ? body.names.map(text) : []),
      ...(Array.isArray(body.shifts)
        ? body.shifts.map((shift) => text((shift as Record<string, unknown> | null)?.employeeName))
        : []),
      text(body.employeeName),
      text(changes.employeeName),
    ].filter(Boolean).slice(0, MAX_BATCH)
    const { employees, directoryDiagnostics } = await activePortalEmployees(requestedNames)
    const action = text(body.action)
    const requestId = text(body.requestId) || crypto.randomUUID()

    if (action === 'sync-directory') {
      await writeScheduleAudit({
        actorId: ACTOR_ID,
        actorType: 'chatgpt',
        action: 'directory-synced',
        details: { employeeCount: employees.length },
      })
      return json({
        integration: 'Dienstplan-Assistent',
        role: 'scheduler',
        employeeCount: employees.length,
        directoryDiagnostics,
      })
    }

    if (action === 'resolve-employees') {
      const names = Array.isArray(body.names) ? body.names.map(text).filter(Boolean).slice(0, MAX_BATCH) : []
      if (!names.length) return json({ message: 'Mindestens ein Mitarbeitername ist erforderlich.' }, 400)
      return json({
        integration: 'Dienstplan-Assistent',
        role: 'scheduler',
        directoryDiagnostics,
        results: names.map((name) => publicResolution(name, employees)),
      })
    }

    if (action === 'list-shifts') return await listAssistantShifts(body, employees)

    if (action === 'get-shift') {
      const shiftId = text(body.shiftId)
      if (!shiftId) return json({ message: 'Dienst-ID fehlt.', code: 'SHIFT_ID_REQUIRED' }, 400)
      const shift = await findScheduleShift(shiftId)
      if (!shift) return json({ message: 'Dienst nicht gefunden.', code: 'NOT_FOUND' }, 404)
      return json({ shift: publicShift(shift) })
    }

    if (action === 'find-duplicates') return await findAssistantDuplicates(body, employees)

    if (action === 'update-shift') return await updateAssistantShift(body, employees, requestId)

    if (action === 'delete-shift') return await deleteAssistantShift(body, requestId)

    if (action === 'publish-shifts') {
      const shifts = Array.isArray(body.shifts) ? body.shifts.slice(0, MAX_BATCH) : []
      if (!shifts.length) return json({ message: 'Mindestens ein Dienst ist erforderlich.' }, 400)
      const allowUnregistered = body.allowUnregistered === true
      const worksites = await activePortalWorksites()
      const results = []
      for (let index = 0; index < shifts.length; index += 1) {
        const input = shifts[index]
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          results.push({ index, status: 'invalid', message: 'Dienst ist ungültig.' })
          continue
        }
        results.push(await publishOne(input as PublishInput, index, requestId, employees, worksites, allowUnregistered))
      }
      return json({
        integration: 'Dienstplan-Assistent',
        role: 'scheduler',
        requestId,
        directoryDiagnostics,
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
