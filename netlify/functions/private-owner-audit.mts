import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { currentPortalActor } from './_shared/portal-role.mts'
import { isPrivateAuditOwner, listPortalAdminChanges, type PrivateAuditEvent } from './_shared/portal-private-audit-service.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

const OMIT = /password|passwort|token|secret|cookie|authorization|credential|private.?key|base64|pdf.?logo.?data|body|attachment|content/i

function safeObject(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (depth > 2) return null
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !OMIT.test(key))
    .slice(0, 24)
    .map(([key, item]) => {
      const v = typeof item === 'string'
        ? item.slice(0, 240)
        : Array.isArray(item)
          ? item.slice(0, 20).map((entry) => typeof entry === 'string' ? entry.slice(0, 120) : entry)
          : item && typeof item === 'object' ? safeObject(item, depth + 1) : item
      return [key.slice(0, 60), v]
    })
  return Object.fromEntries(entries)
}

function dbEvent(row: Record<string, unknown>, category: string, source: string): PrivateAuditEvent {
  const meta = safeObject(row.details)
  return {
    id: String(row.id || ''),
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
    actorId: String(row.actor_id || ''),
    actorRole: String(row.actor_role || row.actor_type || ''),
    actorEmail: String(row.actor_email || ''),
    category,
    action: String(row.action || ''),
    entityId: String(row.entity_id || row.shift_id || row.entry_id || ''),
    summary: String(row.reason || meta?.summary || ''),
    before: safeObject(row.before_data) || safeObject(meta?.before),
    after: safeObject(row.after_data) || safeObject(meta?.after) || meta,
    source,
  }
}

async function historicalEvents() {
  const warnings: string[] = []
  const events: PrivateAuditEvent[] = []
  try {
    const db = getDatabase()
    const sources = [
      {
        category: 'Dienstplan',
        source: 'schedule_audit_log',
        sql: "SELECT id,occurred_at,actor_id,actor_type,action,shift_id,details FROM schedule_audit_log WHERE actor_type <> 'migration' ORDER BY occurred_at DESC LIMIT 300",
      },
      {
        category: 'Arbeitszeiten',
        source: 'attendance_audit_log',
        sql: "SELECT id,occurred_at,actor_id,actor_email,actor_role,action,entity_id,reason,before_data,after_data FROM attendance_audit_log WHERE actor_role IN ('owner','admin','manager') ORDER BY occurred_at DESC LIMIT 300",
      },
      {
        category: 'Dokumente',
        source: 'employee_document_access_audit',
        sql: "SELECT a.id,a.occurred_at,a.actor_user_id AS actor_id,a.action,a.document_id AS entity_id,jsonb_build_object('employeeUserId',d.employee_user_id,'documentType',d.document_type,'title',d.title) AS after_data FROM employee_document_access_audit a JOIN employee_documents d ON d.id = a.document_id WHERE a.action IN ('upload','revoke') ORDER BY a.occurred_at DESC LIMIT 300",
      },
      {
        category: 'Stundenzettel',
        source: 'timesheet_audit_log',
        sql: "SELECT id,occurred_at,actor_id,actor_role,action,entry_id,reason,before_data,after_data FROM timesheet_audit_log WHERE actor_role IN ('owner','admin','manager') ORDER BY occurred_at DESC LIMIT 300",
      },
    ]
    const results = await Promise.allSettled(sources.map((source) => db.pool.query(source.sql)))
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        warnings.push(sources[i].category + ': ältere Protokolle konnten nicht geladen werden.')
        return
      }
      const source = sources[i]
      for (const row of result.value.rows || []) {
        try { events.push(dbEvent(row, source.category, source.source)) }
        catch { /* Ignore malformed legacy rows, not the entire history. */ }
      }
    })
  } catch {
    warnings.push('Datenbankprotokolle sind momentan nicht erreichbar.')
  }
  return { events, warnings }
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export default async function privateOwnerAudit(request: Request, _context: Context) {
  if (request.method !== 'GET') return json({ message: 'Methode nicht erlaubt.' }, 405)

  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)

  let allowed = false
  try {
    allowed = await isPrivateAuditOwner({ userId: current.userId, role: current.role, email: current.email })
  } catch (error) {
    console.error('Private-audit account-ID verification failed', error)
    return json({ message: 'Die private Kontoprüfung ist derzeit nicht verfügbar.' }, 503)
  }
  if (!allowed) return json({ message: 'Keine Berechtigung.' }, 403)

  const url = new URL(request.url)
  const resource = url.searchParams.get('resource') || 'events'

  if (resource === 'access') {
    return json({ allowed: true, userId: current.userId, email: current.email, role: current.role })
  }
  if (resource !== 'events') return json({ message: 'Unbekannte Ansicht.' }, 400)

  try {
    const [stored, historic] = await Promise.all([listPortalAdminChanges(500), historicalEvents()])
    const actorIds = Array.from(new Set([...stored, ...historic.events].map((item) => item.actorId).filter(Boolean))).slice(0, 80)
    const access = getStore({ name: 'portal-access', consistency: 'strong' })
    const actorNames = Object.fromEntries((await Promise.all(actorIds.map(async (id) => {
      if (id === current.userId) return [id, 'Sufian']
      try {
        const row = await access.get('access/' + id, { type: 'json' }) as { fullName?: string } | null
        return [id, String(row?.fullName || '')]
      } catch { return [id, ''] }
    }))).filter((row) => row[1]))

    const from = validDate(url.searchParams.get('from'))
    const to = validDate(url.searchParams.get('to'))
    const q = String(url.searchParams.get('q') || '').toLocaleLowerCase('de').trim().slice(0, 100)
    const category = String(url.searchParams.get('category') || '').trim()
    const items = [...stored, ...historic.events]
      .filter((event) => !from || event.occurredAt.slice(0, 10) >= from)
      .filter((event) => !to || event.occurredAt.slice(0, 10) <= to)
      .filter((event) => !category || event.category === category)
      .filter((event) => !q || [event.actorId, actorNames[event.actorId], event.category, event.action, event.summary, event.entityId].some((field) => String(field || '').toLocaleLowerCase('de').includes(q)))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 500)
      .map((event) => ({ ...event, actorName: actorNames[event.actorId] || event.actorEmail || event.actorId }))

    return json({ events: items, warnings: historic.warnings, limit: 500, accountId: current.userId, partial: Boolean(historic.warnings.length) })
  } catch (error) {
    console.error('Private-audit read failed', error)
    return json({ message: 'Der Änderungsverlauf konnte nicht geladen werden.' }, 500)
  }
}

export const config: Config = { path: '/api/private-owner-audit' }
