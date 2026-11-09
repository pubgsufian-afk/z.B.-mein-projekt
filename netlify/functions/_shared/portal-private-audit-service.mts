import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

export type AuditActor = { userId: string; email?: string; role: string }
export type PrivateAuditEvent = {
  id: string
  occurredAt: string
  actorId: string
  actorRole: string
  actorEmail: string
  category: string
  action: string
  entityId: string
  targetName?: string
  summary: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  source: string
}

const AUDIT_STORE_NAME = 'habun-private-owner-audit'
const STORE_PREFIX = 'events/'
const SECRET_KEY = /pass(word|wort)?|token|secret|cookie|session|authorization|credentials|private.?key|pdf.?logo.?data|data.?url|base64|content|attachment|file.?data|bericht.?text|message.?body/i
const MAX_STRING = 220

function store() {
  return getStore({ name: AUDIT_STORE_NAME, consistency: 'strong' })
}

function limited(value: unknown, depth = 0): unknown {
  if (depth > 2) return '[Details gekürzt]'
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING)
  if (Array.isArray(value)) return value.slice(0, 15).map((item) => limited(item, depth + 1))
  if (typeof value !== 'object') return String(value).slice(0, MAX_STRING)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .slice(0, 24)
      .map(([key, entry]) => [key.slice(0, 60), limited(entry, depth + 1)]),
  )
}

function details(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return limited(value) as Record<string, unknown>
}

function compact(value: unknown, length = 180) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, length)
}

/**
 * A verified Identity login with the configured private e-mail may bind
 * the one permitted account ID exactly once. All later access requires
 * that precise ID. Role 'owner' alone NEVER grants audit access.
 */
export async function isPrivateAuditOwner(actor: AuditActor | null | undefined) {
  const email = compact(actor?.email, 250).toLowerCase()
  const configured = compact(Netlify.env.get('PORTAL_PRIVATE_AUDIT_OWNER_EMAIL'), 250).toLowerCase()
  if (!actor?.userId || actor.role !== 'owner' || !configured || email !== configured) return false
  const audit = store()
  const lock = await audit.get('owner/identity-lock', { type: 'json' }) as { userId?: string } | null
  if (lock) return lock.userId === actor.userId
  await audit.setJSON('owner/identity-lock', { userId: actor.userId, boundAt: new Date().toISOString() })
  const stored = await audit.get('owner/identity-lock', { type: 'json' }) as { userId?: string } | null
  return stored?.userId === actor.userId
}

export async function recordPortalAdminChange(input: {
  actor: AuditActor
  category: string
  action: string
  entityId?: string
  targetName?: string
  summary?: string
  before?: unknown
  after?: unknown
}) {
  if (!input.actor?.userId || !['owner', 'admin', 'manager'].includes(input.actor.role)) return
  const now = new Date()
  const id = randomUUID()
  const event: PrivateAuditEvent = {
    id,
    occurredAt: now.toISOString(),
    actorId: compact(input.actor.userId, 180),
    actorRole: compact(input.actor.role, 32),
    actorEmail: compact(input.actor.email, 250),
    category: compact(input.category, 64),
    action: compact(input.action, 100),
    entityId: compact(input.entityId, 180),
    targetName: compact(input.targetName, 180),
    summary: compact(input.summary, 280),
    before: details(input.before),
    after: details(input.after),
    source: 'portal',
  }
  // Reverse chronological keys; private data is never exposed by a public route.
  const order = String(Number.MAX_SAFE_INTEGER - now.getTime()).padStart(16, '0')
  await store().setJSON(STORE_PREFIX + order + '-' + id, event)
}

export async function tryRecordPortalAdminChange(input: Parameters<typeof recordPortalAdminChange>[0]) {
  try {
    await recordPortalAdminChange(input)
  } catch (error) {
    console.error('Admin activity audit write failed', error)
  }
}

export async function listPortalAdminChanges(limit = 350) {
  const audit = store()
  const list = await audit.list({ prefix: STORE_PREFIX })
  const keys = list.blobs.slice(0, Math.max(1, Math.min(limit, 500))).map((item) => item.key)
  const entries = await Promise.all(keys.map((key) => audit.get(key, { type: 'json' }) as Promise<PrivateAuditEvent | null>))
  return entries.filter((item): item is PrivateAuditEvent => Boolean(item && item.actorId && item.occurredAt))
}
