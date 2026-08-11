import type { Config } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { requirePortalRole } from './_shared/portal-role.mts'
import { listTimesheetEntries, writeTimesheetAudit } from './_shared/timesheet-repository.mts'
import {
  createManualTimesheetEntry,
  deleteManualTimesheetEntry,
  findTimesheetEntry,
  updateManualTimesheetEntry,
} from './_shared/timesheet-manual-repository.mts'
import { syncPublishedScheduleRange, plannedNetMinutes } from './_shared/timesheet-schedule-sync.mts'
import {
  correctionDeadlineForMonth,
  isTimesheetScheduleSyncOpen,
  monthKeyForDate,
} from './_shared/timesheet-month-policy.mts'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MANAGEMENT = ['owner', 'admin', 'manager'] as const

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

function text(value: unknown, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function dayNumber(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86400000
}

function validateRange(from: string, to: string) {
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

function cleanEntry(input: Record<string, unknown>, fallback?: Awaited<ReturnType<typeof findTimesheetEntry>>) {
  const employeeUserId = text(input.employeeUserId ?? fallback?.employeeUserId, 120)
  const employeeName = text(input.employeeName ?? fallback?.employeeName, 160)
  const workDate = text(input.workDate ?? input.date ?? fallback?.workDate, 10)
  const start = text(input.start ?? fallback?.start, 5)
  const end = text(input.end ?? fallback?.end, 5)
  const location = text(input.location ?? fallback?.location, 160)
  const workArea = text(input.workArea ?? fallback?.workArea, 160)
  const pauseMinutes = Number(input.pauseMinutes ?? fallback?.pauseMinutes ?? 0)

  if (!employeeUserId || !employeeName || !location || !workArea) throw new TypeError('Mitarbeiter, Einsatzort und Bereich sind erforderlich.')
  monthKeyForDate(workDate)
  if (!TIME.test(start) || !TIME.test(end) || minutes(end) <= minutes(start)) throw new TypeError('Beginn oder Ende ist ungültig.')
  const gross = minutes(end) - minutes(start)
  if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0 || pauseMinutes > gross) throw new TypeError('Pause ist ungültig.')
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

function requireReason(value: unknown) {
  const reason = text(value, 300)
  if (!reason) throw new TypeError('Eine Begründung ist erforderlich.')
  return reason
}

export default async function timesheets(request: Request) {
  const access = await requirePortalRole([...MANAGEMENT])
  if (access.response || !access.current) return access.response
  const current = access.current

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const from = text(url.searchParams.get('from'), 10)
      const to = text(url.searchParams.get('to'), 10)
      if (!validateRange(from, to)) return json({ message: 'Zeitraum ist ungültig.' }, 400)
      const now = new Date()
      await syncPublishedScheduleRange(from, to, current.userId, now)
      const userId = text(url.searchParams.get('userId'), 120)
      const entries = await listTimesheetEntries({ from, to, ...(userId ? { employeeUserId: userId } : {}) })
      const months = monthKeys(from, to).map((month) => ({
        month,
        correctionDeadline: correctionDeadlineForMonth(month),
        scheduleSyncOpen: isTimesheetScheduleSyncOpen(month, now),
      }))
      return json({ entries, months })
    }

    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)
    try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
    const action = text(body.action, 40)

    if (request.method === 'POST' && action === 'manual-create') {
      const reason = requireReason(body.reason)
      const values = cleanEntry(body)
      const saved = await createManualTimesheetEntry(values, current.userId)
      await writeTimesheetAudit({
        actorId: current.userId, actorRole: current.role, action: 'manual-create', entryId: saved.id,
        monthKey: monthKeyForDate(saved.workDate), reason, beforeData: null, afterData: saved,
      })
      return json({ entry: saved }, 201)
    }

    if (request.method === 'PATCH' && action === 'manual-update') {
      const id = text(body.id, 120)
      const reason = requireReason(body.reason)
      const existing = id ? await findTimesheetEntry(id) : null
      if (!existing) return json({ message: 'Stundenzettel-Eintrag wurde nicht gefunden.' }, 404)
      const values = cleanEntry(body, existing)
      const saved = await updateManualTimesheetEntry(id, values, current.userId)
      if (!saved) return json({ message: 'Stundenzettel-Eintrag konnte nicht geändert werden.' }, 409)
      await writeTimesheetAudit({
        actorId: current.userId, actorRole: current.role, action: 'manual-update', entryId: saved.id,
        monthKey: monthKeyForDate(saved.workDate), reason, beforeData: existing, afterData: saved,
      })
      return json({ entry: saved })
    }

    if (request.method === 'DELETE' && action === 'manual-delete') {
      const id = text(body.id, 120)
      const reason = requireReason(body.reason)
      const existing = id ? await findTimesheetEntry(id) : null
      if (!existing) return json({ message: 'Stundenzettel-Eintrag wurde nicht gefunden.' }, 404)
      if (existing.scheduleShiftId || existing.source !== 'manual') {
        return json({ message: 'Dienstplan-Einträge können korrigiert, aber nicht als manueller Eintrag gelöscht werden.' }, 409)
      }
      const removed = await deleteManualTimesheetEntry(id)
      if (!removed) return json({ message: 'Stundenzettel-Eintrag konnte nicht gelöscht werden.' }, 409)
      await writeTimesheetAudit({
        actorId: current.userId, actorRole: current.role, action: 'manual-delete', entryId: removed.id,
        monthKey: monthKeyForDate(removed.workDate), reason, beforeData: removed, afterData: null,
      })
      return json({ deleted: true, id })
    }

    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    if (error instanceof TypeError) return json({ message: error.message }, 400)
    console.error('timesheets failed', error)
    return json({ message: 'Stundenzettel konnten nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/timesheets' }
