export type ScheduleWorkerCommand = {
  version: 1
  commandId: string
  createdAt: string
  action: 'sync-directory' | 'publish-shifts'
  shifts?: unknown[]
}

type ParseResult =
  | { ok: true; command: ScheduleWorkerCommand }
  | { ok: false; command?: undefined; message: string }

const MAX_AGE_MS = 30 * 60 * 1000

function text(value: unknown) {
  return String(value ?? '').trim()
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

  const action = text(parsed.action)
  if (action !== 'sync-directory' && action !== 'publish-shifts') {
    return { ok: false, message: 'Command-Aktion ist ungültig.' }
  }

  if (action === 'publish-shifts' && (!Array.isArray(parsed.shifts) || parsed.shifts.length === 0)) {
    return { ok: false, message: 'Dienstliste fehlt.' }
  }

  const command: ScheduleWorkerCommand = {
    version: 1,
    commandId,
    createdAt: new Date(createdMs).toISOString(),
    action,
  }
  if (action === 'publish-shifts') command.shifts = (parsed.shifts as unknown[]).slice(0, 100)
  return { ok: true, command }
}
