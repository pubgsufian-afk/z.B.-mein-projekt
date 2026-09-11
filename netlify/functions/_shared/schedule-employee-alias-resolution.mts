import {
  normalizeAssistantName,
  resolveAssistantEmployee,
  type AssistantDirectoryEmployee,
} from './schedule-assistant-core.mts'
import type { EmployeeAliasRecord } from './employee-alias-service.mts'

export function resolveAssistantEmployeeWithAliases(
  name: unknown,
  employees: AssistantDirectoryEmployee[],
  aliases: Array<Pick<EmployeeAliasRecord, 'alias' | 'normalizedAlias' | 'userId'>>,
) {
  const direct = resolveAssistantEmployee(name, employees)
  if (direct.status !== 'not_found') return direct

  const normalized = normalizeAssistantName(name)
  if (!normalized) return direct

  const aliasRows = aliases.filter((alias) => (
    normalizeAssistantName(alias.normalizedAlias || alias.alias) === normalized
  ))
  const targetIds = [...new Set(aliasRows.map((alias) => String(alias.userId || '').trim()).filter(Boolean))]
  const candidates = targetIds
    .map((userId) => employees.find((employee) => employee.userId === userId))
    .filter((employee): employee is AssistantDirectoryEmployee => Boolean(employee))

  if (candidates.length === 1) {
    return { status: 'matched' as const, employee: candidates[0], candidates }
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous' as const, employee: null, candidates }
  }
  return direct
}
