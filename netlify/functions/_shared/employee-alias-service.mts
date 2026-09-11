import { getStore } from '@netlify/blobs'
import { normalizeAssistantName } from './schedule-assistant-core.mts'

export type EmployeeAliasRecord = {
  alias: string
  normalizedAlias: string
  userId: string
  createdAt: string
  updatedAt: string
  updatedBy: string
}

const STORE_NAME = 'portal-employee-aliases'
const INDEX_KEY = 'aliases/index.json'

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

function text(value: unknown, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function mapRecord(value: unknown): EmployeeAliasRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const alias = text(row.alias)
  const normalizedAlias = normalizeAssistantName(row.normalizedAlias || alias)
  const userId = text(row.userId)
  if (!alias || !normalizedAlias || !userId) return null
  return {
    alias,
    normalizedAlias,
    userId,
    createdAt: text(row.createdAt, 100),
    updatedAt: text(row.updatedAt, 100),
    updatedBy: text(row.updatedBy),
  }
}

function cleanRows(value: unknown): EmployeeAliasRecord[] {
  if (!Array.isArray(value)) return []
  const byAlias = new Map<string, EmployeeAliasRecord>()
  for (const row of value) {
    const mapped = mapRecord(row)
    if (mapped) byAlias.set(mapped.normalizedAlias, mapped)
  }
  return [...byAlias.values()].sort((left, right) => left.alias.localeCompare(right.alias, 'de'))
}

async function readAliasIndex() {
  const aliasStore = store()
  const rows = cleanRows(await aliasStore.get(INDEX_KEY, { type: 'json' }))
  return { aliasStore, rows }
}

export async function listEmployeeAliases(): Promise<EmployeeAliasRecord[]> {
  const { rows } = await readAliasIndex()
  return rows
}

export async function saveEmployeeAlias(input: { alias: unknown; userId: unknown; actorId: unknown }) {
  const alias = text(input.alias)
  const normalizedAlias = normalizeAssistantName(alias)
  const userId = text(input.userId)
  const actorId = text(input.actorId) || 'portal-admin-relay'
  if (!alias || !normalizedAlias) throw Object.assign(new Error('Alias ist erforderlich.'), { code: 'ALIAS_REQUIRED' })
  if (!userId) throw Object.assign(new Error('Mitarbeiter-ID ist erforderlich.'), { code: 'EMPLOYEE_REQUIRED' })

  const { aliasStore, rows } = await readAliasIndex()
  const existing = rows.find((row) => row.normalizedAlias === normalizedAlias) || null
  if (existing && existing.userId !== userId) {
    throw Object.assign(new Error('Dieser Alias ist bereits einem anderen Mitarbeiter zugeordnet.'), { code: 'ALIAS_CONFLICT' })
  }

  const now = new Date().toISOString()
  const record: EmployeeAliasRecord = {
    alias,
    normalizedAlias,
    userId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: actorId,
  }
  const next = rows.filter((row) => row.normalizedAlias !== normalizedAlias)
  next.push(record)
  next.sort((left, right) => left.alias.localeCompare(right.alias, 'de'))
  await aliasStore.setJSON(INDEX_KEY, next)
  return record
}

export async function deleteEmployeeAlias(input: { alias: unknown; actorId?: unknown }) {
  const normalizedAlias = normalizeAssistantName(input.alias)
  if (!normalizedAlias) throw Object.assign(new Error('Alias ist erforderlich.'), { code: 'ALIAS_REQUIRED' })

  const { aliasStore, rows } = await readAliasIndex()
  const existing = rows.find((row) => row.normalizedAlias === normalizedAlias) || null
  if (!existing) return { deleted: false, alias: text(input.alias) }

  await aliasStore.setJSON(
    INDEX_KEY,
    rows.filter((row) => row.normalizedAlias !== normalizedAlias),
  )
  return { deleted: true, alias: existing.alias, userId: existing.userId }
}
