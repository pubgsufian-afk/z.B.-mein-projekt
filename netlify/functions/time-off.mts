import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { currentPortalActor } from './_shared/portal-role.mts'
import { tryRecordPortalAdminChange } from './_shared/portal-private-audit-service.mts'

const MANAGERS = new Set(['owner', 'admin', 'manager'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Actor = NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>
type RequestBody = Record<string, unknown>

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' },
  })
}

function validDate(value: unknown) {
  const date = String(value || '').trim()
  return DATE.test(date) && !Number.isNaN(Date.parse(date + 'T12:00:00Z'))
    && new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date
}

function localToday() {
  const pieces = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date())
  const part = (kind: string) => pieces.find((entry) => entry.type === kind)?.value || ''
  return part('year') + '-' + part('month') + '-' + part('day')
}

function mapRequest(row: Record<string, any>) {
  return {
    id: String(row.id), employeeUserId: String(row.employee_user_id), employeeName: String(row.employee_name),
    date: String(row.requested_date instanceof Date ? row.requested_date.toISOString().slice(0, 10) : row.requested_date).slice(0, 10),
    reason: String(row.reason || ''), status: String(row.status),
    decisionNote: String(row.decision_note || ''),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
  }
}

function mapDay(row: Record<string, any>) {
  return {
    employeeUserId: String(row.employee_user_id), employeeName: String(row.employee_name),
    date: String(row.day_off_date instanceof Date ? row.day_off_date.toISOString().slice(0, 10) : row.day_off_date).slice(0, 10),
    source: String(row.source), requestId: row.request_id ? String(row.request_id) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function employeeName(actor: Actor): Promise<string> {
  const record = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get('access/' + actor.userId, { type: 'json' }) as { fullName?: string; status?: string } | null
  const meta = (actor.user as { userMetadata?: Record<string, unknown> }).userMetadata || {}
  const name = String(record?.fullName || meta.full_name || meta.fullName || actor.email.split('@')[0] || 'Mitarbeiter').trim()
  return name.slice(0, 120)
}

async function resolveEmployee(userId: string) {
  // The registration directory is authoritative; schedule_employees can lag behind a new signup.
  const access = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get('access/' + userId, { type: 'json' }) as { fullName?: string; status?: string } | null
  if (access) {
    return access.status === 'active' && String(access.fullName || '').trim()
      ? { user_id: userId, full_name: String(access.fullName).trim() } : null
  }
  // Legacy owner or scheduler accounts may predate the access directory.
  const result = await getDatabase().pool.query(
    "SELECT user_id, full_name FROM schedule_employees WHERE user_id = $1 AND status = 'active'",
    [userId],
  )
  return result.rows[0] || null
}

async function list(actor: Actor, url: URL) {
  const management = MANAGERS.has(String(actor.role))
  const scope = url.searchParams.get('resource') || 'all'
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  if (from && !validDate(from) || to && !validDate(to) || from && to && from > to) {
    return json({ message: 'Ungültiger Datumsbereich.' }, 400)
  }
  if (!['all', 'requests', 'days'].includes(scope)) return json({ message: 'Unbekannte Ansicht.' }, 400)
  const db = getDatabase()
  const output: Record<string, unknown> = {}
  if (scope === 'all' || scope === 'requests') {
    const values: unknown[] = []
    const condition = management ? '' : ' WHERE employee_user_id = $1'
    if (!management) values.push(actor.userId)
    const result = await db.pool.query(
      'SELECT r.*, EXISTS (SELECT 1 FROM schedule_shifts s WHERE s.employee_user_id = r.employee_user_id AND s.shift_date = r.requested_date) AS has_shift'
      + ' FROM schedule_time_off_requests r' + condition
      + " ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 300",
      values,
    )
    output.requests = result.rows.map((row) => ({ ...mapRequest(row), hasShift: Boolean(row.has_shift) }))
  }
  if (scope === 'all' || scope === 'days') {
    const conditions: string[] = []
    const values: unknown[] = []
    if (!management) { values.push(actor.userId); conditions.push('employee_user_id = $' + values.length) }
    if (from) { values.push(from); conditions.push('day_off_date >= $' + values.length + '::date') }
    if (to) { values.push(to); conditions.push('day_off_date <= $' + values.length + '::date') }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''
    const result = await db.pool.query(
      'SELECT * FROM schedule_days_off' + where + ' ORDER BY day_off_date, employee_name LIMIT 500',
      values,
    )
    output.daysOff = result.rows.map(mapDay)
  }
  return json(output)
}

async function submitRequest(actor: Actor, body: RequestBody) {
  if (!validDate(body.date)) return json({ message: 'Bitte ein gültiges Datum auswählen.' }, 400)
  const date = String(body.date)
  if (date < localToday()) return json({ message: 'Für vergangene Tage kann kein Freiwunsch beantragt werden.' }, 400)
  const reason = String(body.reason || '').trim()
  if (reason.length < 3 || reason.length > 500) return json({ message: 'Bitte einen Grund zwischen 3 und 500 Zeichen eintragen.' }, 400)
  const name = await employeeName(actor)
  const db = getDatabase()
  const existing = await db.pool.query(
    'SELECT 1 FROM schedule_days_off WHERE employee_user_id = $1 AND day_off_date = $2::date',
    [actor.userId, date],
  )
  if (existing.rows.length) return json({ message: 'Dieser Tag ist bereits als dienstfrei eingetragen.' }, 409)
  const id = crypto.randomUUID()
  const result = await db.pool.query(
    "INSERT INTO schedule_time_off_requests (id, employee_user_id, employee_name, requested_date, reason, status) VALUES ($1,$2,$3,$4::date,$5,'pending') RETURNING *",
    [id, actor.userId, name, date, reason],
  )
  return json({ request: mapRequest(result.rows[0]) }, 201)
}

async function decideRequest(actor: Actor, body: RequestBody) {
  if (!MANAGERS.has(String(actor.role))) return json({ message: 'Nur die Einsatzleitung und Administration dürfen entscheiden.' }, 403)
  const id = String(body.id || '').trim()
  const decision = String(body.decision || '')
  const note = String(body.note || '').trim()
  if (!id || !['approve', 'reject'].includes(decision) || note.length > 500) return json({ message: 'Entscheidung ungültig.' }, 400)
  const client = await getDatabase().pool.connect()
  let previous: Record<string, any> | null = null
  let result: Record<string, any> | null = null
  try {
    await client.query('BEGIN')
    const found = await client.query('SELECT * FROM schedule_time_off_requests WHERE id = $1 FOR UPDATE', [id])
    if (!found.rows.length) { await client.query('ROLLBACK'); return json({ message: 'Anfrage nicht gefunden.' }, 404) }
    previous = found.rows[0]
    if (previous.status !== 'pending') { await client.query('ROLLBACK'); return json({ message: 'Die Anfrage wurde bereits bearbeitet.' }, 409) }
    if (decision === 'approve') {
      await client.query(
        "INSERT INTO schedule_days_off (employee_user_id, day_off_date, employee_name, source, request_id, created_by) VALUES ($1,$2::date,$3,'request',$4,$5)",
        [previous.employee_user_id, previous.requested_date, previous.employee_name, id, actor.userId],
      )
    }
    const update = await client.query(
      'UPDATE schedule_time_off_requests SET status=$2, decision_note=$3, decided_at=now(), decided_by=$4 WHERE id=$1 RETURNING *',
      [id, decision === 'approve' ? 'approved' : 'rejected', note, actor.userId],
    )
    result = update.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  await tryRecordPortalAdminChange({
    actor, category: 'Dienstfrei', action: decision === 'approve' ? 'Freiwunsch genehmigt' : 'Freiwunsch abgelehnt',
    entityId: id, after: { date: result?.requested_date, employeeName: result?.employee_name, decision },
  })
  return json({ request: mapRequest(result!) })
}

async function setDayOff(actor: Actor, body: RequestBody) {
  if (!MANAGERS.has(String(actor.role))) return json({ message: 'Keine Berechtigung.' }, 403)
  const userId = String(body.employeeUserId || '').trim()
  if (!userId || !validDate(body.date)) return json({ message: 'Mitarbeiter und Datum sind erforderlich.' }, 400)
  const employee = await resolveEmployee(userId)
  if (!employee) return json({ message: 'Nur aktive Mitarbeiter können als dienstfrei eingetragen werden.' }, 400)
  const db = getDatabase()
  const result = await db.pool.query(
    "INSERT INTO schedule_days_off (employee_user_id, day_off_date, employee_name, source, created_by) VALUES ($1,$2::date,$3,'manual',$4) RETURNING *",
    [userId, String(body.date), String(employee.full_name), actor.userId],
  )
  await tryRecordPortalAdminChange({
    actor, category: 'Dienstfrei', action: 'Dienstfrei eingetragen',
    entityId: userId + ':' + String(body.date), after: { employeeName: employee.full_name, date: body.date },
  })
  return json({ dayOff: mapDay(result.rows[0]) }, 201)
}

async function removeDayOff(actor: Actor, body: RequestBody) {
  if (!MANAGERS.has(String(actor.role))) return json({ message: 'Keine Berechtigung.' }, 403)
  const userId = String(body.employeeUserId || '').trim()
  if (!userId || !validDate(body.date)) return json({ message: 'Mitarbeiter und Datum sind erforderlich.' }, 400)
  const client = await getDatabase().pool.connect()
  let previous: Record<string, any> | null = null
  try {
    await client.query('BEGIN')
    const deleted = await client.query(
      'DELETE FROM schedule_days_off WHERE employee_user_id=$1 AND day_off_date=$2::date RETURNING *',
      [userId, String(body.date)],
    )
    if (!deleted.rows.length) { await client.query('ROLLBACK'); return json({ message: 'Kein freier Tag gefunden.' }, 404) }
    previous = deleted.rows[0]
    if (previous.request_id) {
      await client.query(
        "UPDATE schedule_time_off_requests SET status='revoked', decided_at=now(), decided_by=$2 WHERE id=$1 AND status='approved'",
        [previous.request_id, actor.userId],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  await tryRecordPortalAdminChange({
    actor, category: 'Dienstfrei', action: 'Dienstfrei aufgehoben',
    entityId: userId + ':' + String(body.date), before: { employeeName: previous?.employee_name, date: body.date },
  })
  return json({ removed: true })
}

async function withdraw(actor: Actor, body: RequestBody) {
  const id = String(body.id || '').trim()
  if (!id) return json({ message: 'Anfrage fehlt.' }, 400)
  const result = await getDatabase().pool.query(
    "UPDATE schedule_time_off_requests SET status='withdrawn', decided_at=now() WHERE id=$1 AND employee_user_id=$2 AND status='pending' RETURNING *",
    [id, actor.userId],
  )
  if (!result.rows.length) return json({ message: 'Nur eigene, offene Anfragen können zurückgezogen werden.' }, 409)
  return json({ request: mapRequest(result.rows[0]) })
}

export default async function timeOff(request: Request, _context: Context) {
  const actor = await currentPortalActor()
  if (!actor) return json({ message: 'Bitte anmelden.' }, 401)
  if (actor.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
  const url = new URL(request.url)
  if (request.method === 'GET') {
    try { return await list(actor, url) }
    catch (error) { console.error('Habun time off read', error); return json({ message: 'Freiwünsche konnten nicht geladen werden.' }, 503) }
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as RequestBody | null
  if (!body) return json({ message: 'Ungültige Eingabe.' }, 400)
  try {
    switch (body.action) {
      case 'request': return await submitRequest(actor, body)
      case 'decide': return await decideRequest(actor, body)
      case 'set-day-off': return await setDayOff(actor, body)
      case 'remove-day-off': return await removeDayOff(actor, body)
      case 'withdraw': return await withdraw(actor, body)
      default: return json({ message: 'Unbekannte Aktion.' }, 400)
    }
  } catch (error) {
    const message = String((error as Error)?.message || '')
    const code = String((error as { code?: unknown })?.code || '')
    if (message.includes('HABUN_SHIFT_CONFLICT')) return json({ message: 'Für diesen Tag besteht bereits eine Schicht. Bitte zuerst den Dienstplan klären; keine Schicht wurde gelöscht.', code: 'SHIFT_CONFLICT' }, 409)
    if (message.includes('HABUN_DAY_OFF_CONFLICT')) return json({ message: 'Dieser Mitarbeiter ist bereits als dienstfrei eingetragen.', code: 'DAY_OFF_CONFLICT' }, 409)
    if (code === '23505') return json({ message: 'Für diesen Tag besteht bereits ein freier Tag oder eine offene Anfrage.', code: 'DUPLICATE_DAY' }, 409)
    console.error('Habun time off write', error)
    return json({ message: 'Die Anfrage konnte nicht verarbeitet werden. Bitte später erneut versuchen.' }, 500)
  }
}

export const config: Config = { path: '/api/time-off' }
