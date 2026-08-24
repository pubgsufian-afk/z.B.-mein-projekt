import {
  listSuppressedTimesheetEntries,
  listTimesheetEntries,
  writeTimesheetAudit,
} from './timesheet-repository.mts'
import {
  createManualTimesheetEntry,
  deleteManualTimesheetEntry,
  findTimesheetEntry,
  restoreScheduleTimesheetEntry,
  suppressTimesheetEntry,
  updateManualTimesheetEntry,
} from './timesheet-manual-repository.mts'
import { syncPublishedScheduleRange, plannedNetMinutes } from './timesheet-schedule-sync.mts'
import {
  correctionDeadlineForMonth,
  isTimesheetScheduleSyncOpen,
  monthKeyForDate,
} from './timesheet-month-policy.mts'

export type TimesheetAdminActor = {
  userId: string
  role: 'owner' | 'admin' | 'manager'
}

export class TimesheetAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'TIMESHEET_ADMIN_ERROR') {
    super(message)
    this.name = 'TimesheetAdminError'
    this.status = status
    this.code = code
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function clean(value: unknown, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function dayNumber(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86400000
}

function validRange(from: string, to: string) {
  try {
    monthKeyForDate(from)
    monthKeyForDate(to)
  } catch {
    return false
  }
  return to >= from && dayNumber(to) - dayNumber(from) <= 370
}

function monthKeys(from: string, to: string) {
  const keys: string[] = []
  const [startYear, startMonth] = from.slice(0, 7).split('-').map(Number)
  const endKey = to.slice(0, 7)
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1, 12, 0, 0))
  while (cursor.toISOString().slice(0, 7) <= endKey) {
    keys.push(cursor.toISOString().slice(0, 7))
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 12, 0, 0))
  }
  return keys
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function requireReason(value: unknown) {
  const reason = clean(value, 300)
  if (!reason) throw new TimesheetAdminError('Eine Begründung ist erforderlich.', 400, 'REASON_REQUIRED')
  return reason
}

function cleanEntry(input: Record<string, unknown>, fallback?: Awaited<ReturnType<typeof findTimesheetEntry>>) {
  const employeeUserId = clean(input.employeeUserId ?? fallback?.employeeUserId, 120)
  const employeeName = clean(input.employeeName ?? fallback?.employeeName, 160)
  const workDate = clean(input.workDate ?? input.date ?? fallback?.workDate, 10)
  const start = clean(input.start ?? fallback?.start, 5)
  const end = clean(input.end ?? fallback?.end, 5)
  const location = clean(input.location ?? fallback?.location, 160)
  const workArea = clean(input.workArea ?? fallback?.workArea, 160)
  const pauseMinutes = Number(input.pauseMinutes ?? fallback?.pauseMinutes ?? 0)

  if (!employeeUserId || !employeeName || !location || !workArea) {
    throw new TimesheetAdminError('Mitarbeiter, Einsatzort und Bereich sind erforderlich.', 400, 'FIELDS_REQUIRED')
  }
  try {
    monthKeyForDate(workDate)
  } catch {
    throw new TimesheetAdminError('Das Datum ist ungültig.', 400, 'INVALID_DATE')
  }
  if (!TIME.test(start) || !TIME.test(end) || minutes(end) <= minutes(start)) {
    throw new TimesheetAdminError('Beginn oder Ende ist ungültig.', 400, 'INVALID_TIME')
  }
  const gross = minutes(end) - minutes(start)
  if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0 || pauseMinutes > gross) {
    throw new TimesheetAdminError('Pause ist ungültig.', 400, 'INVALID_PAUSE')
  }
  return {
    employeeUserId,
    employeeName,
    workDate,
    start,
    end,
    pauseMinutes,
    netMinutes: plannedNetMinutes(workDate, start, end, pauseMinutes),
    location,
    workArea,
  }
}

export function createTimesheetAdminService() {
  return {
    async list(actor: TimesheetAdminActor, input: Record<string, unknown>) {
      const from = clean(input.from, 10)
      const to = clean(input.to, 10)
      if (!validRange(from, to)) throw new TimesheetAdminError('Zeitraum ist ungültig.', 400, 'INVALID_RANGE')
      const now = new Date()
      await syncPublishedScheduleRange(from, to, actor.userId, now)
      const userId = clean(input.userId ?? input.employeeUserId, 120)
      const filters = { from, to, ...(userId ? { employeeUserId: userId } : {}) }
      const [entries, suppressedEntries] = await Promise.all([
        listTimesheetEntries(filters),
        listSuppressedTimesheetEntries(filters),
      ])
      const months = monthKeys(from, to).map((month) => ({
        month,
        correctionDeadline: correctionDeadlineForMonth(month),
        scheduleSyncOpen: isTimesheetScheduleSyncOpen(month, now),
      }))
      return { entries, suppressedEntries, months }
    },

    async createManual(actor: TimesheetAdminActor, input: Record<string, unknown>) {
      const reason = requireReason(input.reason)
      const values = cleanEntry(input)
      const saved = await createManualTimesheetEntry(values, actor.userId)
      await writeTimesheetAudit({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'manual-create',
        entryId: saved.id,
        monthKey: monthKeyForDate(saved.workDate),
        reason,
        beforeData: null,
        afterData: saved,
      })
      return saved
    },

    async updateManual(actor: TimesheetAdminActor, input: Record<string, unknown>) {
      const id = clean(input.id, 120)
      const reason = requireReason(input.reason)
      const existing = id ? await findTimesheetEntry(id) : null
      if (!existing) throw new TimesheetAdminError('Stundenzettel-Eintrag wurde nicht gefunden.', 404, 'ENTRY_NOT_FOUND')
      const values = cleanEntry(input, existing)
      const saved = await updateManualTimesheetEntry(id, values, actor.userId)
      if (!saved) throw new TimesheetAdminError('Stundenzettel-Eintrag konnte nicht geändert werden.', 409, 'UPDATE_CONFLICT')
      await writeTimesheetAudit({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'manual-update',
        entryId: saved.id,
        monthKey: monthKeyForDate(saved.workDate),
        reason,
        beforeData: existing,
        afterData: saved,
      })
      return saved
    },

    async deleteEntry(actor: TimesheetAdminActor, input: Record<string, unknown>) {
      const id = clean(input.id, 120)
      const reason = requireReason(input.reason)
      const existing = id ? await findTimesheetEntry(id) : null
      if (!existing) throw new TimesheetAdminError('Stundenzettel-Eintrag wurde nicht gefunden.', 404, 'ENTRY_NOT_FOUND')
      const removed = existing.scheduleShiftId
        ? await suppressTimesheetEntry(id, actor.userId)
        : await deleteManualTimesheetEntry(id)
      if (!removed) throw new TimesheetAdminError('Stundenzettel-Eintrag konnte nicht gelöscht werden.', 409, 'DELETE_CONFLICT')
      await writeTimesheetAudit({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'manual-delete',
        entryId: removed.id,
        monthKey: monthKeyForDate(removed.workDate),
        reason,
        beforeData: existing,
        afterData: existing.scheduleShiftId ? removed : null,
      })
      return { deleted: true, id, suppressed: Boolean(existing.scheduleShiftId) }
    },

    async restoreSchedule(actor: TimesheetAdminActor, input: Record<string, unknown>) {
      const id = clean(input.id, 120)
      const reason = requireReason(input.reason)
      const existing = id ? await findTimesheetEntry(id) : null
      if (!existing || !existing.scheduleShiftId) {
        throw new TimesheetAdminError('Dienstplan-Stundenzettel wurde nicht gefunden.', 404, 'ENTRY_NOT_FOUND')
      }
      const now = new Date()
      if (!isTimesheetScheduleSyncOpen(monthKeyForDate(existing.workDate), now)) {
        throw new TimesheetAdminError('Der abgeschlossene Monat kann nicht mehr automatisch aus dem Dienstplan übernommen werden.', 409, 'MONTH_CLOSED')
      }
      const restored = await restoreScheduleTimesheetEntry(id, actor.userId)
      if (!restored) throw new TimesheetAdminError('Dienstplan-Stundenzettel konnte nicht wiederhergestellt werden.', 409, 'RESTORE_CONFLICT')
      await syncPublishedScheduleRange(existing.workDate, existing.workDate, actor.userId, now)
      const refreshed = await findTimesheetEntry(id)
      await writeTimesheetAudit({
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'schedule-restore',
        entryId: id,
        monthKey: monthKeyForDate(existing.workDate),
        reason,
        beforeData: existing,
        afterData: refreshed || restored,
      })
      return refreshed || restored
    },
  }
}

export function timesheetAdminService() {
  return createTimesheetAdminService()
}
