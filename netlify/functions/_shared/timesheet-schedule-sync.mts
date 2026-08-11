import {
  correctionDeadlineForMonth,
  isTimesheetScheduleSyncOpen,
  monthKeyForDate,
} from './timesheet-month-policy.mts'

type ShiftLike = {
  id: string
  employeeUserId: string
  employeeName: string
  date: string
  start: string
  end: string
  pauseMinutes?: number
  location: string
  workArea: string
  status: 'draft' | 'published'
}

type EntryLike = {
  id: string
  scheduleShiftId: string | null
  employeeUserId: string
  employeeName: string
  workDate: string
  start: string
  end: string
  pauseMinutes: number
  netMinutes: number
  location: string
  workArea: string
  source: 'schedule' | 'manual'
  manualOverride: boolean
}

type Dependencies = {
  listScheduleShifts(filters: { from: string; to: string; publishedOnly: boolean }): Promise<ShiftLike[]>
  ensureTimesheetMonth(monthKey: string, correctionDeadline: string): Promise<unknown>
  findTimesheetEntryByScheduleShiftId(shiftId: string): Promise<EntryLike | null>
  upsertScheduleTimesheetEntry(row: Omit<EntryLike, 'id'> & { scheduleShiftId: string }, actorId: string): Promise<EntryLike | null>
  deleteScheduleTimesheetEntryByShiftId(shiftId: string): Promise<EntryLike | null>
  listScheduleLinkedTimesheetEntries(filters: { from: string; to: string }): Promise<EntryLike[]>
  writeTimesheetAudit(input: Record<string, unknown>): Promise<unknown>
}

export function syncDecision(input: { monthOpen: boolean; status: 'draft' | 'published'; manualOverride: boolean }) {
  if (!input.monthOpen || input.manualOverride) return 'ignore' as const
  return input.status === 'published' ? 'upsert' as const : 'delete' as const
}

function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new TypeError('Ungültige Uhrzeit.')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new TypeError('Ungültige Uhrzeit.')
  return hours * 60 + minutes
}

export function plannedNetMinutes(_date: string, start: string, end: string, pauseMinutes = 0) {
  const startMinutes = clockMinutes(start)
  let endMinutes = clockMinutes(end)
  if (endMinutes <= startMinutes) endMinutes += 24 * 60
  const pause = Math.max(0, Math.round(Number(pauseMinutes) || 0))
  return Math.max(0, endMinutes - startMinutes - pause)
}

function scheduleRow(shift: ShiftLike): Omit<EntryLike, 'id'> & { scheduleShiftId: string } {
  const pauseMinutes = Math.max(0, Math.round(Number(shift.pauseMinutes) || 0))
  return {
    scheduleShiftId: shift.id,
    employeeUserId: shift.employeeUserId,
    employeeName: shift.employeeName,
    workDate: shift.date,
    start: shift.start,
    end: shift.end,
    pauseMinutes,
    netMinutes: plannedNetMinutes(shift.date, shift.start, shift.end, pauseMinutes),
    location: shift.location,
    workArea: shift.workArea,
    source: 'schedule',
    manualOverride: false,
  }
}

export function createTimesheetScheduleSync(deps: Dependencies) {
  async function syncPublishedScheduleShift(shift: ShiftLike, actorId: string, now = new Date()) {
    const targetMonth = monthKeyForDate(shift.date)
    const targetOpen = isTimesheetScheduleSyncOpen(targetMonth, now)
    const existing = await deps.findTimesheetEntryByScheduleShiftId(shift.id)

    if (existing) {
      const existingMonth = monthKeyForDate(existing.workDate)
      if (!isTimesheetScheduleSyncOpen(existingMonth, now)) return { action: 'ignore', reason: 'closed-existing-month' }
    }

    const decision = syncDecision({ monthOpen: targetOpen, status: shift.status, manualOverride: Boolean(existing?.manualOverride) })
    if (decision === 'ignore') return { action: 'ignore' }

    if (decision === 'delete') {
      if (!existing) return { action: 'ignore' }
      const removed = await deps.deleteScheduleTimesheetEntryByShiftId(shift.id)
      if (removed) await deps.writeTimesheetAudit({ actorId, actorRole: 'system', action: 'schedule-sync-delete', entryId: removed.id, monthKey: monthKeyForDate(removed.workDate), beforeData: removed, afterData: null })
      return { action: removed ? 'delete' : 'ignore', entry: removed }
    }

    await deps.ensureTimesheetMonth(targetMonth, correctionDeadlineForMonth(targetMonth))
    const saved = await deps.upsertScheduleTimesheetEntry(scheduleRow(shift), actorId)
    if (saved) await deps.writeTimesheetAudit({ actorId, actorRole: 'system', action: existing ? 'schedule-sync-update' : 'schedule-sync-create', entryId: saved.id, monthKey: targetMonth, beforeData: existing, afterData: saved })
    return { action: saved ? 'upsert' : 'ignore', entry: saved }
  }

  async function removeScheduleShiftFromTimesheet(shiftId: string, shiftDate: string, actorId: string, now = new Date()) {
    const shiftMonth = monthKeyForDate(shiftDate)
    if (!isTimesheetScheduleSyncOpen(shiftMonth, now)) return { action: 'ignore' }
    const existing = await deps.findTimesheetEntryByScheduleShiftId(shiftId)
    if (!existing || existing.manualOverride) return { action: 'ignore' }
    if (!isTimesheetScheduleSyncOpen(monthKeyForDate(existing.workDate), now)) return { action: 'ignore' }
    const removed = await deps.deleteScheduleTimesheetEntryByShiftId(shiftId)
    if (removed) await deps.writeTimesheetAudit({ actorId, actorRole: 'system', action: 'schedule-sync-delete', entryId: removed.id, monthKey: monthKeyForDate(removed.workDate), beforeData: removed, afterData: null })
    return { action: removed ? 'delete' : 'ignore', entry: removed }
  }

  async function syncPublishedScheduleRange(from: string, to: string, actorId: string, now = new Date()) {
    const shifts = await deps.listScheduleShifts({ from, to, publishedOnly: true })
    const publishedIds = new Set(shifts.map((shift) => shift.id))
    let upserted = 0
    let removed = 0
    for (const shift of shifts) {
      const result = await syncPublishedScheduleShift(shift, actorId, now)
      if (result.action === 'upsert') upserted += 1
    }
    const linked = await deps.listScheduleLinkedTimesheetEntries({ from, to })
    for (const entry of linked) {
      if (!entry.scheduleShiftId || publishedIds.has(entry.scheduleShiftId) || entry.manualOverride) continue
      if (!isTimesheetScheduleSyncOpen(monthKeyForDate(entry.workDate), now)) continue
      const result = await removeScheduleShiftFromTimesheet(entry.scheduleShiftId, entry.workDate, actorId, now)
      if (result.action === 'delete') removed += 1
    }
    return { upserted, removed }
  }

  return { syncPublishedScheduleShift, removeScheduleShiftFromTimesheet, syncPublishedScheduleRange }
}

let defaultServicePromise: Promise<ReturnType<typeof createTimesheetScheduleSync>> | null = null

async function defaultService() {
  if (!defaultServicePromise) defaultServicePromise = Promise.all([
    import('./timesheet-repository.mts'),
    import('./schedule-neon-repository.mts'),
  ]).then(([timesheets, schedule]) => createTimesheetScheduleSync({
    listScheduleShifts: schedule.listScheduleShifts,
    ensureTimesheetMonth: timesheets.ensureTimesheetMonth,
    findTimesheetEntryByScheduleShiftId: timesheets.findTimesheetEntryByScheduleShiftId,
    upsertScheduleTimesheetEntry: timesheets.upsertScheduleTimesheetEntry,
    deleteScheduleTimesheetEntryByShiftId: timesheets.deleteScheduleTimesheetEntryByShiftId,
    listScheduleLinkedTimesheetEntries: timesheets.listScheduleLinkedTimesheetEntries,
    writeTimesheetAudit: timesheets.writeTimesheetAudit,
  }))
  return defaultServicePromise
}

export async function syncPublishedScheduleShift(shift: ShiftLike, actorId: string, now = new Date()) {
  return (await defaultService()).syncPublishedScheduleShift(shift, actorId, now)
}

export async function removeScheduleShiftFromTimesheet(shiftId: string, shiftDate: string, actorId: string, now = new Date()) {
  return (await defaultService()).removeScheduleShiftFromTimesheet(shiftId, shiftDate, actorId, now)
}

export async function syncPublishedScheduleRange(from: string, to: string, actorId: string, now = new Date()) {
  return (await defaultService()).syncPublishedScheduleRange(from, to, actorId, now)
}
