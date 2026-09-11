import { getStore } from '@netlify/blobs'
import { databaseConnectionString } from './database-connection.mts'
import { employeeAdminService, type EmployeeAdminActor } from './employee-admin-service.mts'
import { listEmployeeAliases } from './employee-alias-service.mts'
import { isProvisionalEmployeeUserId } from './schedule-provisional-employee.mts'
import { listScheduleShifts } from './schedule-neon-repository.mts'
import { normalizeAssistantName } from './schedule-assistant-core.mts'
import { resolveScheduleWorkArea } from './schedule-work-policy.mts'

const RELAY_ACTOR: EmployeeAdminActor = { userId: 'portal-admin-relay', role: 'owner' }
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 62
const MAX_DETAILS = 10

function text(value: unknown, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return dateOnly(value)
}

function normalizeRange(input: Record<string, unknown>) {
  const today = dateOnly(new Date())
  const from = text(input.from, 20) || addDays(today, -31)
  const to = text(input.to, 20) || addDays(today, 30)
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) throw new TypeError('Zeitraum ist ungültig.')
  const fromMs = Date.parse(`${from}T12:00:00Z`)
  const toMs = Date.parse(`${to}T12:00:00Z`)
  const inclusiveDays = Math.floor((toMs - fromMs) / 86400000) + 1
  if (!Number.isFinite(inclusiveDays) || inclusiveDays < 1 || inclusiveDays > MAX_RANGE_DAYS) {
    throw new RangeError(`Zeitraum darf höchstens ${MAX_RANGE_DAYS} Tage umfassen.`)
  }
  return { from, to, inclusiveDays }
}

async function activeWorksiteIds() {
  const store = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await store.list({ prefix: 'objects/' })
  const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<Record<string, unknown> | null>))
  return new Set(rows.map((row) => text(row?.id)).filter(Boolean))
}

async function attendanceUnknownIdentityCount(from: string, to: string) {
  const connection = databaseConnectionString()
  if (!connection) return null
  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(connection)
    const rows = await sql.query(
      `SELECT COUNT(*)::int AS count
         FROM attendance_events e
         LEFT JOIN schedule_employees s
           ON s.user_id = e.user_id
          AND s.status = 'active'
        WHERE e.event_date BETWEEN $1::date AND $2::date
          AND s.user_id IS NULL`,
      [from, to],
    )
    return Number(rows[0]?.count || 0)
  } catch {
    return null
  }
}

function duplicateCounts(shifts: Awaited<ReturnType<typeof listScheduleShifts>>) {
  const exact = new Map<string, number>()
  const time = new Map<string, number>()
  for (const shift of shifts) {
    const identity = shift.employeeUserId
    const timeKey = [identity, shift.date, shift.start, shift.end].join('|')
    const exactKey = [timeKey, normalizeAssistantName(shift.location), normalizeAssistantName(shift.workArea)].join('|')
    time.set(timeKey, (time.get(timeKey) || 0) + 1)
    exact.set(exactKey, (exact.get(exactKey) || 0) + 1)
  }
  const pairCount = (values: Iterable<number>) => [...values].reduce((sum, count) => sum + (count > 1 ? (count * (count - 1)) / 2 : 0), 0)
  const exactPairs = pairCount(exact.values())
  const timePairs = pairCount(time.values())
  return { exact: exactPairs, time: Math.max(0, timePairs - exactPairs) }
}

export async function inspectPortalHealth(rawInput: Record<string, unknown> = {}) {
  const range = normalizeRange(rawInput)
  const service = employeeAdminService()
  const [employees, shifts, worksites, aliases, attendanceUnknown] = await Promise.all([
    service.listEmployees(RELAY_ACTOR, { status: 'active' }),
    listScheduleShifts({ from: range.from, to: range.to }),
    activeWorksiteIds(),
    listEmployeeAliases(),
    attendanceUnknownIdentityCount(range.from, range.to),
  ])

  const employeeIds = new Set(employees.map((employee) => employee.userId))
  const guestIds = [...new Set(shifts.filter((shift) => isProvisionalEmployeeUserId(shift.employeeUserId)).map((shift) => shift.employeeUserId))]
  const unknownEmployeeIds = [...new Set(shifts
    .filter((shift) => !isProvisionalEmployeeUserId(shift.employeeUserId) && !employeeIds.has(shift.employeeUserId))
    .map((shift) => shift.employeeUserId))]
  const invalidWorksiteShifts = shifts.filter((shift) => !shift.objectId || !worksites.has(shift.objectId))
  const noncanonicalWorkAreas = shifts.filter((shift) => {
    const resolved = resolveScheduleWorkArea(shift.workArea)
    return !resolved || resolved.label !== shift.workArea
  })
  const staleAliases = aliases.filter((alias) => !employeeIds.has(alias.userId))
  const duplicates = duplicateCounts(shifts)

  return {
    range,
    counts: {
      activeEmployees: employees.length,
      scheduleShifts: shifts.length,
      guestIdentityIds: guestIds.length,
      guestShiftEntries: shifts.filter((shift) => isProvisionalEmployeeUserId(shift.employeeUserId)).length,
      unknownEmployeeIds: unknownEmployeeIds.length,
      exactDuplicatePairs: duplicates.exact,
      timeDuplicatePairs: duplicates.time,
      invalidWorksiteReferences: invalidWorksiteShifts.length,
      noncanonicalWorkAreas: noncanonicalWorkAreas.length,
      aliases: aliases.length,
      staleAliases: staleAliases.length,
      attendanceUnknownIdentityEvents: attendanceUnknown,
    },
    problems: {
      guestIdentityIds: guestIds.slice(0, MAX_DETAILS),
      unknownEmployeeIds: unknownEmployeeIds.slice(0, MAX_DETAILS),
      invalidWorksiteShiftIds: invalidWorksiteShifts.slice(0, MAX_DETAILS).map((shift) => shift.id),
      noncanonicalWorkAreas: [...new Set(noncanonicalWorkAreas.map((shift) => shift.workArea))].slice(0, MAX_DETAILS),
      staleAliases: staleAliases.slice(0, MAX_DETAILS).map((alias) => ({ alias: alias.alias, userId: alias.userId })),
    },
    healthy: guestIds.length === 0
      && unknownEmployeeIds.length === 0
      && duplicates.exact === 0
      && duplicates.time === 0
      && invalidWorksiteShifts.length === 0
      && noncanonicalWorkAreas.length === 0
      && staleAliases.length === 0
      && (attendanceUnknown == null || attendanceUnknown === 0),
  }
}
