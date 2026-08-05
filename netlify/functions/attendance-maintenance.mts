import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set((Netlify.env.get('PORTAL_OWNER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
  const access = await getStore({ name: 'portal-access', consistency: 'strong' }).get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadata = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string') : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata, ...direct].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

function databaseUrl() {
  return Netlify.env.get('ATTENDANCE_DATABASE_URL') || Netlify.env.get('DATABASE_URL') || Netlify.env.get('NETLIFY_DATABASE_URL') || ''
}

function cleanRequestedData(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const allowed = ['clockInAt', 'clockOutAt', 'pauseMinutes', 'note']
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)))
}

async function connection() {
  const url = databaseUrl()
  if (!url) throw Object.assign(new Error('Die Zeiterfassungsdatenbank ist noch nicht verbunden.'), { status: 503 })
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

async function listCorrections(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>) {
  const rows = await sql(
    `SELECT c.id, c.event_id, c.requested_by, c.reason, c.before_data, c.after_data,
            c.occurred_at, c.expires_at,
            d.decision, d.reason AS decision_reason, d.after_data AS decision_after_data,
            d.occurred_at AS decided_at, d.actor_role AS decided_by_role
       FROM attendance_corrections c
       LEFT JOIN LATERAL (
         SELECT * FROM attendance_correction_decisions d
          WHERE d.correction_id = c.id
          ORDER BY d.occurred_at DESC LIMIT 1
       ) d ON true
      WHERE ($1::boolean OR c.requested_by = $2)
      ORDER BY c.occurred_at DESC`,
    [MANAGEMENT.has(current.role), current.userId],
  )
  return rows
}

async function requestCorrection(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const eventId = String(body.eventId || '').trim()
  const reason = String(body.reason || '').trim()
  if (!eventId || reason.length < 3) return json({ message: 'Buchung und nachvollziehbarer Grund sind erforderlich.' }, 400)
  const events = await sql(`SELECT * FROM attendance_events WHERE id = $1 AND user_id = $2`, [eventId, current.userId])
  if (!events[0]) return json({ message: 'Die Buchung wurde nicht gefunden oder gehört nicht zu diesem Konto.' }, 404)
  const afterData = cleanRequestedData(body.requestedData)
  if (!Object.keys(afterData).length) return json({ message: 'Mindestens eine gewünschte Korrektur ist erforderlich.' }, 400)
  const id = `attendance-correction:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const before = {
    clockAction: events[0].action,
    clientOccurredAt: events[0].client_occurred_at,
    eventDate: events[0].event_date,
    scheduleId: events[0].schedule_id,
    objectId: events[0].object_id,
    locationStatus: events[0].location_status,
  }
  await sql(
    `INSERT INTO attendance_corrections
       (id, event_id, requested_by, actor_id, actor_email, actor_role, reason,
        before_data, after_data, occurred_at, expires_at)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::timestamptz,$9::timestamptz + interval '24 months')`,
    [id, eventId, current.userId, current.email, current.role, reason, JSON.stringify(before), JSON.stringify(afterData), now],
  )
  await sql(
    `INSERT INTO attendance_audit_log
       (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
     VALUES ($1,$2::timestamptz,$3,$4,$5,'correction-request','attendance_correction',$6,$7,$8::jsonb,$9::jsonb,$2::timestamptz + interval '24 months')`,
    [`attendance-audit:${crypto.randomUUID()}`, now, current.userId, current.email, current.role, id, reason, JSON.stringify(before), JSON.stringify(afterData)],
  )
  return json({ id, status: 'requested' }, 201)
}

async function decideCorrection(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const correctionId = String(body.correctionId || '').trim()
  const decision = String(body.decision || '').trim()
  const reason = String(body.reason || '').trim()
  if (!correctionId || !['approved', 'rejected', 'clarification'].includes(decision) || reason.length < 2) {
    return json({ message: 'Korrektur, Entscheidung und Begründung sind erforderlich.' }, 400)
  }
  const corrections = await sql(`SELECT * FROM attendance_corrections WHERE id = $1`, [correctionId])
  const correction = corrections[0]
  if (!correction) return json({ message: 'Korrekturantrag nicht gefunden.' }, 404)
  const afterData = decision === 'approved' ? cleanRequestedData(body.afterData || correction.after_data) : correction.before_data
  const id = `attendance-decision:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await sql(
    `INSERT INTO attendance_correction_decisions
       (id, correction_id, decision, actor_id, actor_email, actor_role, reason,
        request_data, before_data, after_data, occurred_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::timestamptz,$11::timestamptz + interval '24 months')`,
    [id, correctionId, decision, current.userId, current.email, current.role, reason,
      JSON.stringify(correction.after_data), JSON.stringify(correction.before_data), JSON.stringify(afterData), now],
  )
  await sql(
    `INSERT INTO attendance_audit_log
       (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
     VALUES ($1,$2::timestamptz,$3,$4,$5,$6,'attendance_correction',$7,$8,$9::jsonb,$10::jsonb,$2::timestamptz + interval '24 months')`,
    [`attendance-audit:${crypto.randomUUID()}`, now, current.userId, current.email, current.role, `correction-${decision}`, correctionId, reason,
      JSON.stringify(correction.before_data), JSON.stringify(afterData)],
  )
  return json({ id, correctionId, decision }, 201)
}

async function retention(sql: Awaited<ReturnType<typeof connection>>, current: NonNullable<Awaited<ReturnType<typeof actor>>>, apply: boolean) {
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Nur die Administration darf Aufbewahrungsdaten bereinigen.' }, 403)
  const locationCount = await sql(
    `SELECT count(*)::int AS count FROM attendance_locations l
      WHERE l.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
  )
  const eventCount = await sql(
    `SELECT count(*)::int AS count FROM attendance_events e
      WHERE e.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
  )
  if (apply) {
    await sql(
      `DELETE FROM attendance_locations l WHERE l.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
    )
    await sql(
      `DELETE FROM attendance_events e WHERE e.expires_at <= now()
        AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
    )
  }
  return json({ dryRun: !apply, expiredLocations: locationCount[0]?.count || 0, expiredEvents: eventCount[0]?.count || 0 })
}

export default async function maintenance(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
  let sql
  try { sql = await connection() } catch (error) { return json({ message: error.message }, error.status || 500) }
  const url = new URL(request.url)
  if (request.method === 'GET') {
    if ((url.searchParams.get('resource') || 'corrections') === 'corrections') return json({ corrections: await listCorrections(sql, current) })
    return json({ message: 'Unbekannter Bereich.' }, 400)
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || '')
  try {
    if (action === 'request-correction') return await requestCorrection(sql, current, body)
    if (action === 'decide-correction') return await decideCorrection(sql, current, body)
    if (action === 'retention-dry-run') return await retention(sql, current, false)
    if (action === 'retention-apply') return await retention(sql, current, true)
    return json({ message: 'Unbekannte Aktion.' }, 400)
  } catch (error) {
    console.error('Habun attendance maintenance', error)
    return json({ message: 'Die Korrektur- oder Aufbewahrungsaktion ist fehlgeschlagen.' }, 500)
  }
}

export const config: Config = { path: '/api/attendance-maintenance' }
