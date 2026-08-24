import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { admin } from '@netlify/identity'
import { normalizeAssistantName } from './schedule-assistant-core.mts'
import {
  combineScheduleAccessRows,
  mergeScheduleIdentityDirectory,
  requestedScheduleIdentityFallback,
  type ScheduleAccessRecord,
  type ScheduleIdentityUser,
  type ScheduleRegistrationRecord,
} from './schedule-identity-directory.mts'
import { listScheduleShifts } from './schedule-neon-repository.mts'
import {
  listAttendanceHistory,
  listLegacyTimesheetEntries,
} from './portal-admin-history-repository.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HISTORY_RESULT_LIMIT = 350_000
const HISTORY_DOMAINS = new Set(['schedule', 'attendance'])

type HistoryDomain = 'schedule' | 'attendance'

export type HistoryInspection = {
  employeeUserId: string
  employeeName: string
  from: string
  to: string
  domains: HistoryDomain[]
}

class PortalHistoryError extends Error {
  status: 'not_found' | 'conflict' | 'rejected'
  code: string
  constructor(message: string, status: PortalHistoryError['status'], code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function text(value: unknown, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function normalizeHistoryInspection(input: Record<string, unknown>): HistoryInspection {
  const employeeUserId = text(input.employeeUserId)
  const employeeName = text(input.employeeName)
  if (!employeeUserId && !employeeName) throw new TypeError('Mitarbeiter ist erforderlich.')

  const from = text(input.from, 20)
  const to = text(input.to, 20)
  if (!validDate(from) || !validDate(to) || to < from) throw new TypeError('Zeitraum ist ungültig.')

  const requestedDomains = Array.isArray(input.domains) ? input.domains.map((value) => text(value, 30)) : ['schedule', 'attendance']
  const domains = [...new Set(requestedDomains)].filter((value): value is HistoryDomain => HISTORY_DOMAINS.has(value))
  if (!domains.length || domains.length !== new Set(requestedDomains).size) throw new TypeError('Historienbereiche sind ungültig.')

  return { employeeUserId, employeeName, from, to, domains }
}

export function portalHistoryResultTooLarge(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') > HISTORY_RESULT_LIMIT
}

function ownerEmails() {
  return new Set(
    String(Netlify.env.get('PORTAL_OWNER_EMAILS') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

async function portalDirectory(requestedName: string) {
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
  const requested = requestedName
    ? requestedScheduleIdentityFallback(identityUsers, combined, owners, [requestedName])
    : []
  const byUserId = new Map(merged.map((employee) => [employee.userId, employee]))
  for (const employee of requested) if (!byUserId.has(employee.userId)) byUserId.set(employee.userId, employee)
  return [...byUserId.values()]
}

async function fallbackScheduleEmployees(filters: { userId?: string; name?: string }) {
  const database = getDatabase()
  if (filters.userId) {
    const result = await database.pool.query(
      `SELECT user_id, full_name, role, status, location
         FROM schedule_employees
        WHERE user_id = $1
        LIMIT 2`,
      [filters.userId],
    )
    return result.rows.map((row) => ({
      userId: text(row.user_id), fullName: text(row.full_name), role: text(row.role), status: text(row.status), location: text(row.location),
    }))
  }
  const normalized = normalizeAssistantName(filters.name || '')
  if (!normalized) return []
  const result = await database.pool.query(
    `SELECT user_id, full_name, role, status, location
       FROM schedule_employees
      WHERE lower(regexp_replace(btrim(full_name), '\\s+', ' ', 'g')) = $1
      ORDER BY user_id
      LIMIT 3`,
    [normalized],
  )
  return result.rows.map((row) => ({
    userId: text(row.user_id), fullName: text(row.full_name), role: text(row.role), status: text(row.status), location: text(row.location),
  }))
}

async function resolveEmployee(input: HistoryInspection) {
  const directory = await portalDirectory(input.employeeName)
  if (input.employeeUserId) {
    const direct = directory.find((employee) => employee.userId === input.employeeUserId)
    if (direct) return { userId: direct.userId, fullName: direct.fullName }
    const fallback = await fallbackScheduleEmployees({ userId: input.employeeUserId })
    if (fallback.length === 1) return { userId: fallback[0].userId, fullName: fallback[0].fullName || input.employeeName }
    if (input.employeeName) return { userId: input.employeeUserId, fullName: input.employeeName }
    throw new PortalHistoryError('Mitarbeiter wurde nicht gefunden.', 'not_found', 'EMPLOYEE_NOT_FOUND')
  }

  const normalized = normalizeAssistantName(input.employeeName)
  const matches = directory.filter((employee) => normalizeAssistantName(employee.fullName) === normalized)
  if (matches.length === 1) return { userId: matches[0].userId, fullName: matches[0].fullName }
  if (matches.length > 1) throw new PortalHistoryError('Mitarbeitername ist nicht eindeutig.', 'conflict', 'EMPLOYEE_AMBIGUOUS')

  const fallback = await fallbackScheduleEmployees({ name: input.employeeName })
  if (fallback.length === 1) return { userId: fallback[0].userId, fullName: fallback[0].fullName }
  if (fallback.length > 1) throw new PortalHistoryError('Mitarbeitername ist nicht eindeutig.', 'conflict', 'EMPLOYEE_AMBIGUOUS')
  throw new PortalHistoryError('Mitarbeiter wurde nicht gefunden.', 'not_found', 'EMPLOYEE_NOT_FOUND')
}

async function matchingProvisionalIdentities(input: HistoryInspection, fullName: string) {
  if (!input.domains.includes('schedule')) return []
  const database = getDatabase()
  const normalized = normalizeAssistantName(fullName)
  const result = await database.pool.query(
    `SELECT DISTINCT employee_user_id, employee_name
       FROM schedule_shifts
      WHERE shift_date BETWEEN $1::date AND $2::date
        AND employee_user_id LIKE 'guest:%'
        AND lower(regexp_replace(btrim(employee_name), '\\s+', ' ', 'g')) = $3
      ORDER BY employee_user_id`,
    [input.from, input.to, normalized],
  )
  return result.rows.map((row) => ({ userId: text(row.employee_user_id), fullName: text(row.employee_name) }))
}

export async function inspectPortalEmployeeHistory(rawInput: Record<string, unknown>) {
  const input = normalizeHistoryInspection(rawInput)
  const employee = await resolveEmployee(input)

  const [schedule, legacyTimesheet, attendance, provisionalIdentities] = await Promise.all([
    input.domains.includes('schedule')
      ? listScheduleShifts({ from: input.from, to: input.to, employeeUserId: employee.userId })
      : Promise.resolve([]),
    input.domains.includes('schedule')
      ? listLegacyTimesheetEntries({ from: input.from, to: input.to, employeeUserId: employee.userId })
      : Promise.resolve([]),
    input.domains.includes('attendance')
      ? listAttendanceHistory({ from: input.from, to: input.to, employeeUserId: employee.userId })
      : Promise.resolve([]),
    matchingProvisionalIdentities(input, employee.fullName),
  ])

  const result = {
    employee,
    range: { from: input.from, to: input.to },
    provisionalIdentities,
    schedule,
    legacyTimesheet,
    attendance,
    counts: {
      schedule: schedule.length,
      legacyTimesheet: legacyTimesheet.length,
      attendance: attendance.length,
    },
    truncated: false,
  }
  return result
}

export function createPortalHistoryAdminHandler(): PortalAdminHandler {
  return async (operation) => {
    if (operation.action !== 'inspect-employee-history') {
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
    }
    try {
      const data = await inspectPortalEmployeeHistory(operation.input)
      if (portalHistoryResultTooLarge(data)) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'conflict',
          code: 'RANGE_RESULT_TOO_LARGE',
          data: { range: data.range, counts: data.counts },
        }
      }
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'success',
        data,
      }
    } catch (error) {
      if (error instanceof PortalHistoryError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: error.status,
          code: error.code,
        }
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'INVALID_HISTORY_REQUEST',
        }
      }
      throw error
    }
  }
}
