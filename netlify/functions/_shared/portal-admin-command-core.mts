export type PortalAdminDomain =
  | 'portal'
  | 'employees'
  | 'registrations'
  | 'schedule'
  | 'attendance'
  | 'worksites'
  | 'company'
  | 'reports'

export type PortalAdminOperation = {
  itemId: string
  domain: PortalAdminDomain
  action: string
  input: Record<string, unknown>
}

export type PortalAdminCommand = {
  version: 1
  commandId: string
  createdAt: string
  domain: PortalAdminDomain
  action: string
  input?: Record<string, unknown>
  operations?: PortalAdminOperation[]
  reason?: string
  responseKey: string
}

type ParseResult =
  | { ok: true; command: PortalAdminCommand }
  | { ok: false; message: string }

const MAX_AGE_MS = 30 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000
const MAX_OPERATIONS = 100
const MAX_COMMAND_BYTES = 400_000
const DOMAINS = new Set<PortalAdminDomain>([
  'portal', 'employees', 'registrations', 'schedule', 'attendance', 'worksites', 'company', 'reports',
])

function text(value: unknown, max = 180) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validResponseKey(value: unknown) {
  try {
    const raw = String(value || '').trim()
    if (!raw) return false
    const decoded = Buffer.from(raw, 'base64')
    if (decoded.length !== 32) return false
    return decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')
  } catch {
    return false
  }
}

function invalid(message: string): ParseResult {
  return { ok: false, message }
}

function normalizeOperation(value: unknown): PortalAdminOperation | null {
  if (!plainObject(value)) return null
  const itemId = text(value.itemId, 120)
  const domain = text(value.domain, 40) as PortalAdminDomain
  const action = text(value.action, 120)
  const input = value.input
  if (!itemId || !DOMAINS.has(domain) || !action || !plainObject(input)) return null
  return { itemId, domain, action, input }
}

export function parsePortalAdminCommand(raw: string, now = new Date()): ParseResult {
  if (typeof raw !== 'string' || !raw.trim()) return invalid('Portal-Admin-Auftrag fehlt.')
  if (Buffer.byteLength(raw, 'utf8') > MAX_COMMAND_BYTES) return invalid('Portal-Admin-Auftrag ist zu groß.')

  let value: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!plainObject(parsed)) return invalid('Portal-Admin-Auftrag ist ungültig.')
    value = parsed
  } catch {
    return invalid('Portal-Admin-Auftrag ist kein gültiges JSON.')
  }

  if (value.version !== 1) return invalid('Portal-Admin-Version ist ungültig.')
  const commandId = text(value.commandId, 160)
  if (!commandId) return invalid('Portal-Admin-commandId fehlt.')

  const createdAt = text(value.createdAt, 80)
  const created = new Date(createdAt)
  if (!createdAt || !Number.isFinite(created.getTime())) return invalid('Portal-Admin-createdAt ist ungültig.')
  const age = now.getTime() - created.getTime()
  if (age > MAX_AGE_MS) return invalid('Portal-Admin-Auftrag ist abgelaufen.')
  if (age < -CLOCK_SKEW_MS) return invalid('Portal-Admin-Auftrag liegt in der Zukunft.')

  const domain = text(value.domain, 40) as PortalAdminDomain
  if (!DOMAINS.has(domain)) return invalid('Portal-Admin-Domain ist ungültig.')
  const action = text(value.action, 120)
  if (!action) return invalid('Portal-Admin-Aktion fehlt.')
  const responseKey = text(value.responseKey, 120)
  if (!validResponseKey(responseKey)) return invalid('Portal-Admin-responseKey ist ungültig.')
  const reason = text(value.reason, 500)

  if (action === 'portal-batch') {
    if (domain !== 'portal') return invalid('portal-batch muss die Domain portal verwenden.')
    if (value.input !== undefined) return invalid('portal-batch darf kein input-Feld enthalten.')
    if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > MAX_OPERATIONS) {
      return invalid('Portal-Admin-Batch muss 1 bis 100 Operationen enthalten.')
    }
    const operations: PortalAdminOperation[] = []
    const itemIds = new Set<string>()
    for (const rawOperation of value.operations) {
      const operation = normalizeOperation(rawOperation)
      if (!operation) return invalid('Portal-Admin-Batch enthält eine ungültige Operation.')
      if (itemIds.has(operation.itemId)) return invalid('Portal-Admin-Batch enthält doppelte itemId.')
      itemIds.add(operation.itemId)
      operations.push(operation)
    }
    return {
      ok: true,
      command: {
        version: 1,
        commandId,
        createdAt: created.toISOString(),
        domain,
        action,
        operations,
        ...(reason ? { reason } : {}),
        responseKey,
      },
    }
  }

  if (value.operations !== undefined) return invalid('Nur portal-batch darf operations enthalten.')
  if (value.input !== undefined && !plainObject(value.input)) return invalid('Portal-Admin-input ist ungültig.')

  return {
    ok: true,
    command: {
      version: 1,
      commandId,
      createdAt: created.toISOString(),
      domain,
      action,
      ...(value.input !== undefined ? { input: value.input } : {}),
      ...(reason ? { reason } : {}),
      responseKey,
    },
  }
}
