import { createHash } from 'node:crypto'
import { normalizeAssistantName } from './schedule-assistant-core.mts'

export const PROVISIONAL_EMPLOYEE_PREFIX = 'guest:'

export function isProvisionalEmployeeUserId(value: unknown) {
  return String(value ?? '').startsWith(PROVISIONAL_EMPLOYEE_PREFIX)
}

export function provisionalEmployeeUserId(name: unknown) {
  const normalized = normalizeAssistantName(name)
  if (!normalized) return ''
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex')
  return `${PROVISIONAL_EMPLOYEE_PREFIX}${digest}`
}
