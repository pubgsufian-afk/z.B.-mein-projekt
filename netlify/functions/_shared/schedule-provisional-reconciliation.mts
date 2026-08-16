import { normalizeAssistantName, type AssistantDirectoryEmployee } from './schedule-assistant-core.mts'
import { isProvisionalEmployeeUserId } from './schedule-provisional-employee.mts'

export type ProvisionalEmployeeIdentity = {
  userId: string
  fullName: string
}

export type ProvisionalRebindCandidate = {
  provisionalUserId: string
  userId: string
  fullName: string
}

export function provisionalRebindCandidates(
  guests: ProvisionalEmployeeIdentity[],
  registered: Pick<AssistantDirectoryEmployee, 'userId' | 'fullName'>[],
): ProvisionalRebindCandidate[] {
  const guestsByName = new Map<string, ProvisionalEmployeeIdentity[]>()
  const registeredByName = new Map<string, Pick<AssistantDirectoryEmployee, 'userId' | 'fullName'>[]>()

  for (const guest of guests) {
    if (!isProvisionalEmployeeUserId(guest.userId)) continue
    const normalized = normalizeAssistantName(guest.fullName)
    if (!normalized) continue
    const rows = guestsByName.get(normalized) || []
    rows.push(guest)
    guestsByName.set(normalized, rows)
  }

  for (const employee of registered) {
    if (!employee.userId || isProvisionalEmployeeUserId(employee.userId)) continue
    const normalized = normalizeAssistantName(employee.fullName)
    if (!normalized) continue
    const rows = registeredByName.get(normalized) || []
    rows.push(employee)
    registeredByName.set(normalized, rows)
  }

  const result: ProvisionalRebindCandidate[] = []
  for (const [normalized, guestRows] of guestsByName) {
    const registeredRows = registeredByName.get(normalized) || []
    if (guestRows.length !== 1 || registeredRows.length !== 1) continue
    result.push({
      provisionalUserId: guestRows[0].userId,
      userId: registeredRows[0].userId,
      fullName: registeredRows[0].fullName,
    })
  }
  return result
}
