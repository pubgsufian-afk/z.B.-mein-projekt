export type ScheduleWorkerAction =
  | 'sync-directory'
  | 'publish-shifts'
  | 'list-shifts'
  | 'get-shift'
  | 'find-duplicates'
  | 'update-shift'
  | 'delete-shift'

export type ScheduleWorkerCommand = {
  version: 1
  commandId: string
  createdAt: string
  action: ScheduleWorkerAction
  shifts?: unknown[]
  from?: string
  to?: string
  employeeName?: string
  employeeUserId?: string
  location?: string
  status?: 'draft' | 'published'
  shiftId?: string
  changes?: Record<string, unknown>
  responseKey?: string
}

type ParseResult =
  | { ok: true; command: ScheduleWorkerCommand }
  | { ok: false; command?: undefined; message: string }

const MAX_AGE_MS = 30 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ACTIONS = new Set<ScheduleWorkerAction>([
  'sync-directory',
  'publish-shifts',
  'list-shifts',
  'get-shift',
  'find-duplicates',
  'update-shift',
  'delete-shift',
])

function text(value: unknown) {
  return String(value ?? '').trim()
}

function validResponseKey(value: unknown) {
  const encoded = text(value)
  if (!encoded) return true
  try {
    return Buffer.from(encoded, 'base64').length === 32
  } catch {
    return false
  }
}

export function parseScheduleCommand(raw: unknown, now = new Date()): ParseResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, message: 'Command fehlt.' }

  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'Command ist ungültig.' }
    }
    parsed = value as Record<string, unknown>
  } catch {
    return { ok: false, message: 'Command ist kein gültiges JSON.' }
  }

  if (parsed.version !== 1) return { ok: false, message: 'Command-Version ist ungültig.' }

  const commandId = text(parsed.commandId)
  if (!commandId || commandId.length > 160) return { ok: false, message: 'Command-ID ist ungültig.' }

  const createdAt = text(parsed.createdAt)
  const createdMs = Date.parse(createdAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(createdMs)) return { ok: false, message: 'Command-Zeit ist ungültig.' }
  if (createdMs > nowMs + 5 * 60 * 1000 || nowMs - createdMs > MAX_AGE_MS) {
    return { ok: false, message: 'Command ist abgelaufen.' }
  }

  const action = text(parsed.action) as ScheduleWorkerAction
  if (!ACTIONS.has(action)) return { ok: false, message: 'Command-Aktion ist ungültig.' }

  if (action === 'publish-shifts' && (!Array.isArray(parsed.shifts) || parsed.shifts.length === 0)) {
    return { ok: false, message: 'Dienstliste fehlt.' }
  }

  if (action === 'list-shifts' || action === 'find-duplicates') {
    const from = text(parsed.from)
    const to = text(parsed.to)
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) {
      return { ok: false, message: 'Dienstplan-Zeitraum ist ungültig.' }
    }
  }

  if (action === 'get-shift' || action === 'update-shift' || action === 'delete-shift') {
    if (!text(parsed.shiftId)) return { ok: false, message: 'Dienst-ID fehlt.' }
  }

  if (action === 'update-shift') {
    if (!parsed.changes || typeof parsed.changes !== 'object' || Array.isArray(parsed.changes)
      || Object.keys(parsed.changes as Record<string, unknown>).length === 0) {
      return { ok: false, message: 'Änderungen fehlen.' }
    }
  }

  if (!validResponseKey(parsed.responseKey)) return { ok: false, message: 'Antwortschlüssel ist ungültig.' }

  const requestedStatus = text(parsed.status)
  if (requestedStatus && !['draft', 'published'].includes(requestedStatus)) {
    return { ok: false, message: 'Dienstplanstatus ist ungültig.' }
  }

  const command: ScheduleWorkerCommand = {
    version: 1,
    commandId,
    createdAt: new Date(createdMs).toISOString(),
    action,
  }

  if (action === 'publish-shifts') command.shifts = (parsed.shifts as unknown[]).slice(0, 100)
  if (action === 'list-shifts' || action === 'find-duplicates') {
    command.from = text(parsed.from)
    command.to = text(parsed.to)
    if (text(parsed.employeeName)) command.employeeName = text(parsed.employeeName)
    if (text(parsed.employeeUserId)) command.employeeUserId = text(parsed.employeeUserId)
    if (text(parsed.location)) command.location = text(parsed.location)
    if (requestedStatus) command.status = requestedStatus as 'draft' | 'published'
  }
  if (action === 'get-shift' || action === 'update-shift' || action === 'delete-shift') {
    command.shiftId = text(parsed.shiftId)
  }
  if (action === 'update-shift') command.changes = { ...(parsed.changes as Record<string, unknown>) }
  if (text(parsed.responseKey)) command.responseKey = text(parsed.responseKey)

  return { ok: true, command }
}
