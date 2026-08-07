export type AssistantDirectoryEmployee = {
  userId: string
  fullName: string
  role?: string
  status?: string
  location?: string
}

export type AssistantShiftInput = {
  employeeName?: unknown
  date?: unknown
  start?: unknown
  end?: unknown
  workArea?: unknown
  location?: unknown
  pauseMinutes?: unknown
  note?: unknown
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function text(value: unknown) {
  return String(value ?? '').trim()
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function normalizeAssistantName(value: unknown) {
  return text(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveAssistantEmployee(name: unknown, employees: AssistantDirectoryEmployee[]) {
  const normalized = normalizeAssistantName(name)
  if (!normalized) {
    return { status: 'not_found' as const, employee: null, candidates: [] as AssistantDirectoryEmployee[] }
  }
  const candidates = employees.filter((employee) => normalizeAssistantName(employee.fullName) === normalized)
  if (candidates.length === 1) {
    return { status: 'matched' as const, employee: candidates[0], candidates }
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous' as const, employee: null, candidates }
  }
  return { status: 'not_found' as const, employee: null, candidates }
}

export function defaultAssistantLocation(employee: Pick<AssistantDirectoryEmployee, 'location'>) {
  return text(employee.location) || 'Abbott'
}

export function validateAssistantShiftInput(input: AssistantShiftInput): { ok: true } | { ok: false; message: string } {
  const employeeName = text(input.employeeName)
  const date = text(input.date)
  const start = text(input.start)
  const end = text(input.end)
  const workArea = text(input.workArea)

  if (!employeeName) return { ok: false, message: 'Mitarbeitername fehlt.' }
  if (!ISO_DATE.test(date)) return { ok: false, message: 'Datum ist ungültig.' }
  if (!TIME.test(start) || !TIME.test(end)) return { ok: false, message: 'Beginn oder Ende ist ungültig.' }
  if (timeMinutes(end) <= timeMinutes(start)) return { ok: false, message: 'Ende muss nach dem Beginn liegen.' }
  if (!workArea) return { ok: false, message: 'Bereich fehlt.' }

  const pause = input.pauseMinutes == null || input.pauseMinutes === '' ? 0 : Number(input.pauseMinutes)
  const duration = timeMinutes(end) - timeMinutes(start)
  if (!Number.isFinite(pause) || pause < 0 || pause >= duration) {
    return { ok: false, message: 'Pause ist für diese Dienstzeit ungültig.' }
  }
  return { ok: true }
}
