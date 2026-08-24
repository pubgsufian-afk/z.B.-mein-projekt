import { getStore } from '@netlify/blobs'
import { admin } from '@netlify/identity'
import {
  findScheduleShift,
  listScheduleShifts,
  upsertScheduleShift,
  writeScheduleAudit,
  type ScheduleShift,
} from './schedule-neon-repository.mts'
import {
  classifyAssistantDuplicate,
  normalizeAssistantName,
  resolveAssistantEmployee,
  resolveAssistantWorksite,
  validateAssistantShiftInput,
  type AssistantDirectoryEmployee,
  type AssistantWorksite,
} from './schedule-assistant-core.mts'
import {
  combineScheduleAccessRows,
  mergeScheduleIdentityDirectory,
  requestedScheduleIdentityFallback,
  type ScheduleAccessRecord,
  type ScheduleIdentityUser,
  type ScheduleRegistrationRecord,
} from './schedule-identity-directory.mts'

const ACTOR_ID = 'portal-admin-relay'
const BUSINESS_FIELDS = [
  'employeeUserId', 'employeeName', 'date', 'start', 'end', 'pauseMinutes',
  'objectId', 'location', 'workArea', 'note', 'status',
] as const

function text(value: unknown, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function ownerEmails() {
  return new Set(
    String(Netlify.env.get('PORTAL_OWNER_EMAILS') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

async function activeEmployees(requestedNames: string[]) {
  let accessRows: ScheduleAccessRecord[] = []
  let registrations: ScheduleRegistrationRecord[] = []
  let identityUsers: ScheduleIdentityUser[] = []

  try {
    const store = getStore({ name: 'portal-access', consistency: 'strong' })
    const listed = await store.list({ prefix: 'access/' })
    const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<ScheduleAccessRecord | null>))
    accessRows = rows.filter((row): row is ScheduleAccessRecord => Boolean(row))
  } catch {}

  try {
    const store = getStore({ name: 'portal-registrations', consistency: 'strong' })
    const listed = await store.list({ prefix: 'registration/' })
    const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<ScheduleRegistrationRecord | null>))
    registrations = rows.filter((row): row is ScheduleRegistrationRecord => Boolean(row))
  } catch {}

  try {
    identityUsers = await admin.listUsers() as ScheduleIdentityUser[]
  } catch {}

  const combined = combineScheduleAccessRows(accessRows, registrations)
  const owners = ownerEmails()
  const merged = mergeScheduleIdentityDirectory(identityUsers, combined, owners)
  const requested = requestedScheduleIdentityFallback(identityUsers, combined, owners, requestedNames)
  const byUserId = new Map(merged.map((employee) => [employee.userId, employee]))
  for (const employee of requested) if (!byUserId.has(employee.userId)) byUserId.set(employee.userId, employee)
  return [...byUserId.values()] as AssistantDirectoryEmployee[]
}

async function activeWorksites(): Promise<AssistantWorksite[]> {
  const store = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await store.list({ prefix: 'objects/' })
  const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AssistantWorksite | null>))
  return rows.filter((row): row is AssistantWorksite => Boolean(row))
}

export function scheduleShiftBusinessEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return BUSINESS_FIELDS.every((field) => {
    if (field === 'pauseMinutes') return Number(left[field] || 0) === Number(right[field] || 0)
    const l = left[field] == null ? '' : String(left[field])
    const r = right[field] == null ? '' : String(right[field])
    return l === r
  })
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
    updatedAt: shift.updatedAt,
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

async function updateOne(
  update: Record<string, unknown>,
  employees: AssistantDirectoryEmployee[],
  worksites: AssistantWorksite[],
  commandId: string,
  fallbackIndex: number,
) {
  const itemId = text(update.itemId, 200) || String(fallbackIndex)
  const shiftId = text(update.shiftId, 300)
  if (!shiftId) return { itemId, status: 'rejected', code: 'SHIFT_ID_REQUIRED' }
  const existing = await findScheduleShift(shiftId)
  if (!existing) return { itemId, status: 'not_found', code: 'NOT_FOUND' }

  const rawChanges = update.changes && typeof update.changes === 'object' && !Array.isArray(update.changes)
    ? update.changes as Record<string, unknown>
    : {}

  let employeeUserId = existing.employeeUserId
  let employeeName = existing.employeeName
  if (text(rawChanges.employeeName)) {
    const resolved = resolveAssistantEmployee(rawChanges.employeeName, employees)
    if (resolved.status === 'ambiguous') return { itemId, status: 'conflict', code: 'AMBIGUOUS_EMPLOYEE' }
    if (resolved.status !== 'matched' || !resolved.employee) return { itemId, status: 'not_found', code: 'EMPLOYEE_NOT_FOUND' }
    employeeUserId = resolved.employee.userId
    employeeName = resolved.employee.fullName
  }

  let objectId = existing.objectId
  let location = existing.location
  if (text(rawChanges.location)) {
    const resolved = resolveAssistantWorksite(rawChanges.location, worksites)
    if (resolved.status !== 'matched' || !resolved.worksite) {
      return { itemId, status: 'conflict', code: `LOCATION_${resolved.status.toUpperCase()}` }
    }
    objectId = text(resolved.worksite.id, 300)
    location = text(resolved.worksite.name, 300)
  }

  const candidate: ScheduleShift = {
    ...existing,
    employeeUserId,
    employeeName,
    date: text(rawChanges.date, 20) || existing.date,
    start: text(rawChanges.start, 10) || existing.start,
    end: text(rawChanges.end, 10) || existing.end,
    pauseMinutes: rawChanges.pauseMinutes == null || rawChanges.pauseMinutes === ''
      ? existing.pauseMinutes
      : Math.round(Number(rawChanges.pauseMinutes)),
    objectId,
    location,
    workArea: text(rawChanges.workArea, 300) || existing.workArea,
    note: rawChanges.note == null ? existing.note : text(rawChanges.note, 1000),
  }

  if (scheduleShiftBusinessEqual(existing as unknown as Record<string, unknown>, candidate as unknown as Record<string, unknown>)) {
    return { itemId, status: 'success', data: { changed: false, shift: publicShift(existing) } }
  }

  const validation = validateAssistantShiftInput(candidate)
  if (!validation.ok) return { itemId, status: 'rejected', code: 'INVALID_SHIFT' }

  const dateShifts = (await listScheduleShifts({ from: candidate.date, to: candidate.date }))
    .filter((entry) => entry.id !== candidate.id)
  const classified = classifyAssistantDuplicate(candidate, dateShifts, employees)
  if (classified.exact) return { itemId, status: 'conflict', code: 'EXACT_DUPLICATE', data: { shiftId: classified.exact.id } }
  if (classified.time) return { itemId, status: 'conflict', code: 'TIME_DUPLICATE', data: { shiftId: classified.time.id } }

  const now = new Date().toISOString()
  const changed: ScheduleShift = {
    ...candidate,
    updatedAt: now,
    updatedBy: ACTOR_ID,
  }
  await upsertScheduleShift(changed)
  await writeScheduleAudit({
    actorId: ACTOR_ID,
    actorType: 'chatgpt',
    action: 'shift-updated',
    shiftId: changed.id,
    details: { commandId, itemId, before: auditShift(existing), after: auditShift(changed) },
  })
  const verified = await findScheduleShift(changed.id)
  if (!verified) return { itemId, status: 'rejected', code: 'VERIFY_FAILED' }
  return {
    itemId,
    status: 'success',
    data: {
      changed: true,
      shift: publicShift(verified),
      warnings: classified.overlaps.map((entry) => ({ code: 'OVERLAP', shiftId: entry.id, date: entry.date, start: entry.start, end: entry.end })),
    },
  }
}

export async function bulkUpdateScheduleShifts(input: Record<string, unknown>, commandId = '') {
  const updates = Array.isArray(input.updates) ? input.updates.slice(0, 100) : []
  if (!updates.length) return { results: [{ itemId: '0', status: 'rejected', code: 'UPDATES_REQUIRED' }] }

  const requestedNames = updates
    .map((raw) => raw && typeof raw === 'object' && !Array.isArray(raw)
      ? text(((raw as Record<string, unknown>).changes as Record<string, unknown> | undefined)?.employeeName, 300)
      : '')
    .filter(Boolean)
  const needsWorksites = updates.some((raw) => raw && typeof raw === 'object' && !Array.isArray(raw)
    && Boolean(text(((raw as Record<string, unknown>).changes as Record<string, unknown> | undefined)?.location, 300)))

  const employees = await activeEmployees(requestedNames)
  const worksites = needsWorksites ? await activeWorksites() : []
  const results = []
  for (let index = 0; index < updates.length; index += 1) {
    const raw = updates[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      results.push({ itemId: String(index), status: 'rejected', code: 'INVALID_UPDATE' })
      continue
    }
    try {
      results.push(await updateOne(raw as Record<string, unknown>, employees, worksites, commandId, index))
    } catch {
      results.push({ itemId: text((raw as Record<string, unknown>).itemId, 200) || String(index), status: 'rejected', code: 'UPDATE_FAILED' })
    }
  }
  return { results }
}
