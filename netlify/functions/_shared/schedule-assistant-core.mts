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

export type AssistantWorksite = {
  id?: unknown
  name?: unknown
  latitude?: unknown
  longitude?: unknown
  radiusMeters?: unknown
}

export type AssistantTimeShift = {
  start?: unknown
  end?: unknown
}

export type AssistantPersonShift = {
  id?: unknown
  employeeUserId?: unknown
  employeeName?: unknown
  date?: unknown
  start?: unknown
  end?: unknown
  location?: unknown
  workArea?: unknown
}

export const DEFAULT_ASSISTANT_WORKSITE_NAME = 'Abbott Laboratories GmbH'

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

function editDistance(left: string, right: string) {
  if (left === right) return 0
  if (!left) return right.length
  if (!right) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      const insertion = current[rightIndex - 1] + 1
      const deletion = previous[rightIndex] + 1
      current.push(Math.min(substitution, insertion, deletion))
    }
    previous = current
  }
  return previous[right.length]
}

function tokenTypoBudget(token: string) {
  if (token.length < 3) return 0
  if (token.length < 8) return 1
  return 2
}

function tokensClose(input: string, candidate: string) {
  if (!input || !candidate) return false
  const budget = Math.min(tokenTypoBudget(input), tokenTypoBudget(candidate))
  if (Math.abs(input.length - candidate.length) > budget) return false
  return editDistance(input, candidate) <= budget
}

function fuzzyFullNameCandidates(normalized: string, employees: AssistantDirectoryEmployee[]) {
  const inputTokens = normalized.split(' ').filter(Boolean)
  if (inputTokens.length < 2) return [] as AssistantDirectoryEmployee[]

  return employees.filter((employee) => {
    const employeeTokens = normalizeAssistantName(employee.fullName).split(' ').filter(Boolean)
    if (employeeTokens.length < inputTokens.length) return false
    if (!tokensClose(inputTokens[0], employeeTokens[0])) return false

    let employeeIndex = 1
    for (let inputIndex = 1; inputIndex < inputTokens.length; inputIndex += 1) {
      let matched = false
      while (employeeIndex < employeeTokens.length) {
        if (tokensClose(inputTokens[inputIndex], employeeTokens[employeeIndex])) {
          matched = true
          employeeIndex += 1
          break
        }
        employeeIndex += 1
      }
      if (!matched) return false
    }
    return true
  })
}

export function assistantPersonMatch(
  left: AssistantPersonShift,
  right: AssistantPersonShift,
  activeEmployees: AssistantDirectoryEmployee[],
) {
  const leftId = text(left.employeeUserId)
  const rightId = text(right.employeeUserId)
  if (leftId && rightId && leftId === rightId) return { status: 'same' as const }

  const leftName = normalizeAssistantName(left.employeeName)
  const rightName = normalizeAssistantName(right.employeeName)
  if (!leftName || leftName !== rightName) return { status: 'different' as const }

  const activeSameName = activeEmployees.filter(
    (employee) => employee.status !== 'inactive' && normalizeAssistantName(employee.fullName) === leftName,
  )
  if (activeSameName.length === 1) return { status: 'same' as const }
  if (activeSameName.length > 1) return { status: 'ambiguous' as const }
  return { status: 'different' as const }
}

export function classifyAssistantDuplicate<T extends AssistantPersonShift>(
  candidate: AssistantPersonShift,
  shifts: T[],
  activeEmployees: AssistantDirectoryEmployee[],
) {
  const result: {
    exact: T | null
    time: T | null
    overlaps: T[]
    ambiguous: T[]
  } = {
    exact: null,
    time: null,
    overlaps: [],
    ambiguous: [],
  }

  const candidateDate = text(candidate.date)
  const candidateStart = text(candidate.start)
  const candidateEnd = text(candidate.end)
  const candidateLocation = normalizeAssistantName(candidate.location)
  const candidateWorkArea = normalizeAssistantName(candidate.workArea)
  const candidateStartMinutes = timeMinutes(candidateStart)
  const candidateEndMinutes = timeMinutes(candidateEnd)

  for (const shift of shifts) {
    if (text(shift.date) !== candidateDate) continue
    const person = assistantPersonMatch(candidate, shift, activeEmployees)
    if (person.status === 'different') continue
    if (person.status === 'ambiguous') {
      result.ambiguous.push(shift)
      continue
    }

    const shiftStart = text(shift.start)
    const shiftEnd = text(shift.end)
    if (shiftStart === candidateStart && shiftEnd === candidateEnd) {
      const sameLocation = normalizeAssistantName(shift.location) === candidateLocation
      const sameWorkArea = normalizeAssistantName(shift.workArea) === candidateWorkArea
      if (sameLocation && sameWorkArea) {
        result.exact ||= shift
      } else {
        result.time ||= shift
      }
      continue
    }

    const shiftStartMinutes = timeMinutes(shiftStart)
    const shiftEndMinutes = timeMinutes(shiftEnd)
    if (candidateStartMinutes < shiftEndMinutes && shiftStartMinutes < candidateEndMinutes) {
      result.overlaps.push(shift)
    }
  }

  return result
}

export function resolveAssistantEmployee(name: unknown, employees: AssistantDirectoryEmployee[]) {
  const normalized = normalizeAssistantName(name)
  if (!normalized) {
    return { status: 'not_found' as const, employee: null, candidates: [] as AssistantDirectoryEmployee[] }
  }

  const exactCandidates = employees.filter((employee) => normalizeAssistantName(employee.fullName) === normalized)
  if (exactCandidates.length === 1) {
    return { status: 'matched' as const, employee: exactCandidates[0], candidates: exactCandidates }
  }
  if (exactCandidates.length > 1) {
    return { status: 'ambiguous' as const, employee: null, candidates: exactCandidates }
  }

  if (!normalized.includes(' ')) {
    const firstNameCandidates = employees.filter((employee) => {
      const employeeName = normalizeAssistantName(employee.fullName)
      return employeeName.split(' ')[0] === normalized
    })
    if (firstNameCandidates.length === 1) {
      return { status: 'matched' as const, employee: firstNameCandidates[0], candidates: firstNameCandidates }
    }
    if (firstNameCandidates.length > 1) {
      return { status: 'ambiguous' as const, employee: null, candidates: firstNameCandidates }
    }

    const nonSurnameTokenCandidates = employees.filter((employee) => {
      const tokens = normalizeAssistantName(employee.fullName).split(' ').filter(Boolean)
      const tokenIndex = tokens.indexOf(normalized)
      return tokens.length >= 3 && tokenIndex >= 0 && tokenIndex < tokens.length - 1
    })
    if (nonSurnameTokenCandidates.length === 1) {
      return { status: 'matched' as const, employee: nonSurnameTokenCandidates[0], candidates: nonSurnameTokenCandidates }
    }
    if (nonSurnameTokenCandidates.length > 1) {
      return { status: 'ambiguous' as const, employee: null, candidates: nonSurnameTokenCandidates }
    }

    const fuzzyFirstNameCandidates = employees.filter((employee) => {
      const firstName = normalizeAssistantName(employee.fullName).split(' ')[0]
      return tokensClose(normalized, firstName)
    })
    if (fuzzyFirstNameCandidates.length === 1) {
      return { status: 'matched' as const, employee: fuzzyFirstNameCandidates[0], candidates: fuzzyFirstNameCandidates }
    }
    if (fuzzyFirstNameCandidates.length > 1) {
      return { status: 'ambiguous' as const, employee: null, candidates: fuzzyFirstNameCandidates }
    }
  } else {
    const fuzzyCandidates = fuzzyFullNameCandidates(normalized, employees)
    if (fuzzyCandidates.length === 1) {
      return { status: 'matched' as const, employee: fuzzyCandidates[0], candidates: fuzzyCandidates }
    }
    if (fuzzyCandidates.length > 1) {
      return { status: 'ambiguous' as const, employee: null, candidates: fuzzyCandidates }
    }
  }

  return { status: 'not_found' as const, employee: null, candidates: [] as AssistantDirectoryEmployee[] }
}

export function defaultAssistantLocation(employee: Pick<AssistantDirectoryEmployee, 'location'>) {
  return text(employee.location) || 'Abbott'
}

function configuredAssistantWorksite(worksite: AssistantWorksite) {
  const latitude = Number(worksite.latitude)
  const longitude = Number(worksite.longitude)
  const radiusMeters = Number(worksite.radiusMeters)
  return Boolean(
    text(worksite.id)
      && text(worksite.name)
      && worksite.latitude !== null
      && worksite.latitude !== ''
      && Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && worksite.longitude !== null
      && worksite.longitude !== ''
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180
      && worksite.radiusMeters !== null
      && worksite.radiusMeters !== ''
      && Number.isFinite(radiusMeters)
      && radiusMeters >= 0
      && radiusMeters <= 10000,
  )
}

export function resolveAssistantWorksite(requestedName: unknown, worksites: AssistantWorksite[]) {
  const effectiveName = text(requestedName) || DEFAULT_ASSISTANT_WORKSITE_NAME
  const normalized = normalizeAssistantName(effectiveName)
  const candidates = worksites.filter((worksite) => normalizeAssistantName(worksite.name) === normalized)
  if (!candidates.length) {
    return { status: 'not_found' as const, worksite: null, candidates: [] as AssistantWorksite[] }
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous' as const, worksite: null, candidates }
  }
  if (!configuredAssistantWorksite(candidates[0])) {
    return { status: 'unconfigured' as const, worksite: null, candidates }
  }
  return { status: 'matched' as const, worksite: candidates[0], candidates }
}

export function findAssistantTimeDuplicate<T extends AssistantTimeShift>(candidate: AssistantTimeShift, shifts: T[]) {
  const start = text(candidate.start)
  const end = text(candidate.end)
  return shifts.find((shift) => text(shift.start) === start && text(shift.end) === end) || null
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
