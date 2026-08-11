import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { currentPortalActor } from './_shared/portal-role.mts'
import { ensureLegacyScheduleMigrated as ensureSharedLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'
import { classifyAssistantDuplicate } from './_shared/schedule-assistant-core.mts'
import {
  deleteScheduleShift,
  findExactScheduleDuplicate,
  findScheduleShift,
  listActiveScheduleEmployees,
  listScheduleOverlaps,
  listScheduleShifts,
  listScheduleVersions,
  publishScheduleWeek,
  syncScheduleEmployees,
  upsertScheduleShift,
  writeScheduleAudit,
  type ScheduleEmployee,
  type ScheduleShift,
} from './_shared/schedule-neon-repository.mts'

type WorkSite = {
  id: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  radiusMeters: number
  updatedAt: string
  updatedBy: string
}

type AccessRecord = {
  userId?: string
  role?: string
  status?: string
  fullName?: string
  location?: string
} | null

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const SCHEDULING = new Set(['owner', 'admin', 'manager', 'scheduler'])

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'X-Habun-Schedule-Version': 'v3-neon',
    },
  })
}

function legacyScheduleStore() {
  return getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
}

function accessStore() {
  return getStore({ name: 'portal-access', consistency: 'strong' })
}

async function readBlobMany<T>(prefix: string): Promise<T[]> {
  const store = legacyScheduleStore()
  const listed = await store.list({ prefix })
  const rows = await Promise.all(listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<T | null>))
  return rows.filter((row): row is T => Boolean(row))
}

function mondayOf(value: string) {
  if (!ISO_DATE.test(value)) throw new TypeError('Das Datum ist ungültig.')
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function addDays(value: string, count: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function validateShift(body: Record<string, unknown>) {
  const required = ['employeeUserId', 'employeeName', 'date', 'start', 'end', 'location', 'workArea']
  if (required.some((field) => !String(body[field] || '').trim())) {
    throw new TypeError('Mitarbeiter, Datum, Zeit, Einsatzort und Arbeitsbereich sind erforderlich.')
  }
  if (!ISO_DATE.test(String(body.date))) throw new TypeError('Das Datum ist ungültig.')
  if (!TIME.test(String(body.start)) || !TIME.test(String(body.end))) throw new TypeError('Beginn oder Ende ist ungültig.')
  if (minutes(String(body.end)) <= minutes(String(body.start))) throw new RangeError('Das Dienstende muss nach dem Beginn liegen.')
  const pause = Number(body.pauseMinutes ?? 0)
  const duration = minutes(String(body.end)) - minutes(String(body.start))
  if (!Number.isFinite(pause) || pause < 0 || pause >= duration) throw new RangeError('Die Pause muss kürzer als die Dienstzeit sein.')
}

function makeShift(body: Record<string, unknown>, actorId: string, existing?: ScheduleShift): ScheduleShift {
  validateShift(body)
  const now = new Date().toISOString()
  return {
    id: existing?.id || String(body.id || crypto.randomUUID()),
    employeeUserId: String(body.employeeUserId).trim(),
    employeeName: String(body.employeeName).trim(),
    date: String(body.date),
    start: String(body.start),
    end: String(body.end),
    pauseMinutes: Math.round(Number(body.pauseMinutes || 0)),
    objectId: String(body.objectId || '').trim() || null,
    location: String(body.location).trim(),
    workArea: String(body.workArea).trim(),
    note: String(body.note || '').trim(),
    status: body.status === 'published' ? 'published' : 'draft',
    version: Number(existing?.version || body.version || 0),
    templateId: String(body.templateId || '').trim() || null,
    repeatGroupId: String(body.repeatGroupId || '').trim() || null,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actorId,
    updatedAt: now,
    updatedBy: actorId,
    publishedAt: existing?.publishedAt || null,
    publishedBy: existing?.publishedBy || null,
    source: existing?.source || 'portal',
    sourceRef: existing?.sourceRef || null,
  }
}

async function syncActiveEmployees() {
  const store = accessStore()
  const listed = await store.list({ prefix: 'access/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AccessRecord>),
  )
  const allowedRoles = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])
  const employees = rows
    .filter((row): row is NonNullable<AccessRecord> => Boolean(
      row?.userId && row.status === 'active' && row.role && allowedRoles.has(String(row.role)),
    ))
    .map((row) => ({
      userId: String(row.userId),
      fullName: String(row.fullName || 'Mitarbeiter'),
      role: String(row.role) as ScheduleEmployee['role'],
      status: 'active' as const,
      location: String(row.location || ''),
    }))
  await syncScheduleEmployees(employees, true)
  return employees
}

async function getEntries(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, url: URL) {
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  if (!SCHEDULING.has(String(current.role))) {
    return listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })
  }
  return listScheduleShifts({ from, to })
}

async function saveShift(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, body: Record<string, unknown>) {
  const existing = body.id ? await findScheduleShift(String(body.id)) : null
  const candidate = makeShift(body, current.userId, existing || undefined)
  const activeEmployees = await listActiveScheduleEmployees()
  const dateShifts = (await listScheduleShifts({ from: candidate.date, to: candidate.date }))
    .filter((entry) => entry.id !== candidate.id)
  const duplicate = classifyAssistantDuplicate(candidate, dateShifts, activeEmployees)

  if (duplicate.ambiguous.length) {
    return json({
      message: 'Die Mitarbeiterzuordnung ist mehrdeutig. Der Dienst wurde nicht gespeichert.',
      code: 'AMBIGUOUS_EMPLOYEE',
      conflicts: duplicate.ambiguous.map((entry) => entry.id),
    }, 409)
  }
  if (duplicate.exact) {
    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE', shiftId: duplicate.exact.id }, 409)
  }
  if (duplicate.time) {
    return json({
      message: 'Für diesen Mitarbeiter ist zur gleichen Zeit bereits ein Dienst vorhanden.',
      code: 'TIME_DUPLICATE',
      shiftId: duplicate.time.id,
    }, 409)
  }

  const overlaps = duplicate.overlaps.length
    ? duplicate.overlaps
    : await listScheduleOverlaps(candidate, candidate.id)
  try {
    const shift = await upsertScheduleShift(candidate)
    await writeScheduleAudit({
      actorId: current.userId,
      actorType: 'portal',
      action: existing ? 'shift-updated' : 'shift-created',
      shiftId: shift.id,
      details: { date: shift.date, employeeUserId: shift.employeeUserId, status: shift.status },
    })
    return json({
      shift,
      warnings: overlaps.map((entry) => ({ code: 'OVERLAP', shiftId: entry.id, employeeName: entry.employeeName, date: entry.date, start: entry.start, end: entry.end })),
    }, existing ? 200 : 201)
  } catch (error) {
    if (String((error as { code?: unknown })?.code || '') === '23505') {
      if (await findExactScheduleDuplicate(candidate, candidate.id)) {
        return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE' }, 409)
      }
    }
    throw error
  }
}

async function publishWeek(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, value: string) {
  const week = mondayOf(value)
  const result = await publishScheduleWeek(week, current.userId)
  if (!result.published) return json({ message: 'Für diese Woche ist kein Entwurf vorhanden.' }, 404)
  await writeScheduleAudit({
    actorId: current.userId,
    actorType: 'portal',
    action: 'week-published',
    details: { week, version: result.version, published: result.published },
  })
  return json({ week, version: result.version, published: result.published })
}

async function copyPreviousWeek(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, targetWeek: string) {
  const targetMonday = mondayOf(targetWeek)
  const previousMonday = addDays(targetMonday, -7)
  const source = await listScheduleShifts({ from: previousMonday, to: addDays(previousMonday, 6), publishedOnly: true })
  const created: ScheduleShift[] = []
  for (const item of source) {
    const offset = Math.round((new Date(`${item.date}T12:00:00Z`).getTime() - new Date(`${previousMonday}T12:00:00Z`).getTime()) / 86400000)
    const candidate = makeShift({
      ...item,
      id: crypto.randomUUID(),
      date: addDays(targetMonday, offset),
      status: 'draft',
      version: 0,
    }, current.userId)
    if (await findExactScheduleDuplicate(candidate)) continue
    created.push(await upsertScheduleShift(candidate))
  }
  return json({ created, sourceWeek: previousMonday, targetWeek: targetMonday }, 201)
}

async function repeatShift(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, body: Record<string, unknown>) {
  const source = await findScheduleShift(String(body.id || ''))
  if (!source) return json({ message: 'Der Ausgangsdienst wurde nicht gefunden.' }, 404)
  const dates = Array.isArray(body.dates) ? body.dates.map(String).filter((date) => ISO_DATE.test(date)) : []
  const group = crypto.randomUUID()
  const created: ScheduleShift[] = []
  for (const date of dates) {
    const candidate = makeShift({ ...source, id: crypto.randomUUID(), date, status: 'draft', version: 0, repeatGroupId: group }, current.userId)
    if (await findExactScheduleDuplicate(candidate)) continue
    created.push(await upsertScheduleShift(candidate))
  }
  return json({ created, repeatGroupId: group }, 201)
}

function publicSite(site: WorkSite, includeCoordinates: boolean) {
  return includeCoordinates ? site : { id: site.id, name: site.name, address: site.address, radiusMeters: site.radiusMeters }
}

async function upsertObject(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, body: Record<string, unknown>) {
  if (!['owner', 'admin'].includes(String(current.role))) return json({ message: 'Nur die Administration darf Einsatzort-Koordinaten ändern.' }, 403)
  const id = String(body.id || crypto.randomUUID()).trim()
  const name = String(body.name || '').trim()
  const address = String(body.address || '').trim()
  if (!name || !address) return json({ message: 'Name und Adresse des Einsatzortes sind erforderlich.' }, 400)
  const lat = body.latitude === '' || body.latitude == null ? null : Number(body.latitude)
  const lon = body.longitude === '' || body.longitude == null ? null : Number(body.longitude)
  if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lon !== null && (!Number.isFinite(lon) || Math.abs(lon) > 180))) {
    return json({ message: 'Die Koordinaten sind ungültig.' }, 400)
  }
  const radius = Number(body.radiusMeters || 500)
  if (!Number.isFinite(radius) || radius < 0 || radius > 10000) return json({ message: 'Der Prüfradius ist ungültig.' }, 400)
  const site: WorkSite = { id, name, address, latitude: lat, longitude: lon, radiusMeters: radius, updatedAt: new Date().toISOString(), updatedBy: current.userId }
  await legacyScheduleStore().setJSON(`objects/${id}`, site)
  return json({ object: site }, 201)
}

async function deleteObject(current: NonNullable<Awaited<ReturnType<typeof currentPortalActor>>>, body: Record<string, unknown>) {
  if (!['owner', 'admin'].includes(String(current.role))) return json({ message: 'Nur die Administration darf Einsatzorte löschen.' }, 403)
  const id = String(body.id || '').trim()
  if (!id) return json({ message: 'Der Einsatzort fehlt.' }, 400)
  const key = `objects/${id}`
  const existing = await legacyScheduleStore().get(key, { type: 'json' }) as WorkSite | null
  if (!existing) return json({ message: 'Der Einsatzort wurde nicht gefunden.' }, 404)
  await legacyScheduleStore().delete(key)
  return json({ deleted: true, id })
}

export default async function scheduleV2Neon(request: Request, _context: Context) {
  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)

  try {
    await ensureSharedLegacyScheduleMigrated()
    if (SCHEDULING.has(String(current.role))) await syncActiveEmployees()
  } catch (error) {
    console.error('Habun schedule database bootstrap', error)
    return json({ message: 'Der Dienstplan-Speicher konnte nicht vorbereitet werden.', code: 'SCHEDULE_DATABASE_BOOTSTRAP_FAILED' }, 503)
  }

  const url = new URL(request.url)
  if (request.method === 'GET') {
    const resource = url.searchParams.get('resource') || 'entries'
    if (resource === 'entries') return json({ entries: await getEntries(current, url) })
    if (!SCHEDULING.has(String(current.role))) return json({ message: 'Keine Berechtigung.' }, 403)
    if (resource === 'objects') {
      const objects = await readBlobMany<WorkSite>('objects/')
      return json({ objects: objects.map((site) => publicSite(site, true)) })
    }
    if (resource === 'versions') return json({ versions: await listScheduleVersions() })
    if (resource === 'suggestions') {
      const date = String(url.searchParams.get('date') || '')
      const start = String(url.searchParams.get('start') || '')
      const end = String(url.searchParams.get('end') || '')
      const employees = await listActiveScheduleEmployees()
      const suggestions = await Promise.all(employees.map(async (employee) => {
        const conflicts = ISO_DATE.test(date) && TIME.test(start) && TIME.test(end)
          ? await listScheduleOverlaps({ employeeUserId: employee.userId, date, start, end })
          : []
        return { employeeUserId: employee.userId, employeeName: employee.fullName, available: conflicts.length === 0, conflicts: conflicts.map((entry) => entry.id) }
      }))
      return json({ suggestions })
    }
    return json({ message: 'Unbekannter Dienstplanbereich.' }, 400)
  }

  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  if (!SCHEDULING.has(String(current.role))) return json({ message: 'Keine Berechtigung.' }, 403)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || 'save')

  try {
    if (action === 'save') return await saveShift(current, body)
    if (action === 'delete') {
      const id = String(body.id || '')
      const existing = await findScheduleShift(id)
      if (!existing) return json({ message: 'Dienst nicht gefunden.' }, 404)
      await deleteScheduleShift(id)
      await writeScheduleAudit({ actorId: current.userId, actorType: 'portal', action: 'shift-deleted', shiftId: id })
      return json({ deleted: true, id })
    }
    if (action === 'publish') return await publishWeek(current, String(body.week || body.date || ''))
    if (action === 'copy-previous-week') return await copyPreviousWeek(current, String(body.week || ''))
    if (action === 'repeat') return await repeatShift(current, body)
    if (action === 'object-upsert') return await upsertObject(current, body)
    if (action === 'object-delete') return await deleteObject(current, body)
    return json({ message: 'Unbekannte Dienstplanaktion.' }, 400)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message }, 400)
    if (String((error as { code?: unknown })?.code || '') === '23505') {
      return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE' }, 409)
    }
    console.error('Habun schedule v3 Neon', error)
    return json({ message: 'Der Dienstplan konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/schedule-v2' }
