import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null

type Shift = {
  id: string
  employeeUserId: string
  employeeName: string
  date: string
  start: string
  end: string
  location: string
  workArea: string
  pauseMinutes: number
  note: string
  objectId: string | null
  status: 'draft' | 'published'
  version: number
  templateId: string | null
  repeatGroupId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  publishedAt: string | null
  publishedBy: string | null
}

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

const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const STORE_NAME = 'portal-schedule-v2'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'X-Habun-Schedule-Version': 'v2',
    },
  })
}

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

function accessStore() {
  return getStore({ name: 'portal-access', consistency: 'strong' })
}

async function actor() {
  const user = await getUser()
  if (!user) return null
  const email = String(user.email || '').trim().toLowerCase()
  const owners = new Set(
    (Netlify.env.get('PORTAL_OWNER_EMAILS') || '')
      .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  )
  const access = await accessStore().get(`access/${user.id}`, { type: 'json' }) as AccessRecord
  const metadataRoles = Array.isArray(user.appMetadata?.roles)
    ? user.appMetadata.roles.filter((value): value is string => typeof value === 'string')
    : []
  const direct = typeof (user as { role?: unknown }).role === 'string' ? [(user as { role: string }).role] : []
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadataRoles, ...direct]
          .find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, email, role }
}

async function readMany<T>(prefix: string): Promise<T[]> {
  const current = store()
  const listed = await current.list({ prefix })
  const rows = await Promise.all(listed.blobs.map((blob) => current.get(blob.key, { type: 'json' }) as Promise<T | null>))
  return rows.filter((row): row is T => Boolean(row))
}

function mondayOf(value: string) {
  if (!ISO_DATE.test(value)) throw new TypeError('Das Datum ist ungültig.')
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function shiftKey(shift: Pick<Shift, 'date' | 'id'>) {
  return `shifts/${mondayOf(shift.date)}/${shift.id}`
}

function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('de')
}

function overlap(left: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>, right: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>) {
  return left.employeeUserId === right.employeeUserId
    && left.date === right.date
    && minutes(left.start) < minutes(right.end)
    && minutes(right.start) < minutes(left.end)
}

function exactDuplicate(left: Partial<Shift>, right: Partial<Shift>) {
  return left.employeeUserId === right.employeeUserId
    && left.date === right.date
    && left.start === right.start
    && left.end === right.end
    && normalized(left.location) === normalized(right.location)
    && normalized(left.workArea) === normalized(right.workArea)
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

function makeShift(body: Record<string, unknown>, current: { userId: string }, existing?: Shift): Shift {
  validateShift(body)
  const now = new Date().toISOString()
  return {
    id: existing?.id || String(body.id || crypto.randomUUID()),
    employeeUserId: String(body.employeeUserId).trim(),
    employeeName: String(body.employeeName).trim(),
    date: String(body.date),
    start: String(body.start),
    end: String(body.end),
    location: String(body.location).trim(),
    workArea: String(body.workArea).trim(),
    pauseMinutes: Math.round(Number(body.pauseMinutes || 0)),
    note: String(body.note || '').trim(),
    objectId: String(body.objectId || '').trim() || null,
    status: body.status === 'published' ? 'published' : 'draft',
    version: Number(existing?.version || body.version || 0),
    templateId: String(body.templateId || '').trim() || null,
    repeatGroupId: String(body.repeatGroupId || '').trim() || null,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || current.userId,
    updatedAt: now,
    updatedBy: current.userId,
    publishedAt: existing?.publishedAt || null,
    publishedBy: existing?.publishedBy || null,
  }
}

async function allShifts() {
  return (await readMany<Shift>('shifts/')).sort((a, b) => `${a.date}-${a.start}-${a.employeeName}`.localeCompare(`${b.date}-${b.start}-${b.employeeName}`))
}

async function findShift(id: string) {
  const rows = await allShifts()
  return rows.find((entry) => entry.id === id) || null
}

function publicSite(site: WorkSite, includeCoordinates: boolean) {
  return includeCoordinates ? site : { id: site.id, name: site.name, address: site.address, radiusMeters: site.radiusMeters }
}

async function getEntries(current: NonNullable<Awaited<ReturnType<typeof actor>>>, url: URL) {
  let entries = await allShifts()
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (from && ISO_DATE.test(from)) entries = entries.filter((entry) => entry.date >= from)
  if (to && ISO_DATE.test(to)) entries = entries.filter((entry) => entry.date <= to)
  if (!MANAGEMENT.has(current.role)) {
    entries = entries.filter((entry) => entry.employeeUserId === current.userId && entry.status === 'published')
  }
  return entries
}

async function saveShift(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const existing = body.id ? await findShift(String(body.id)) : null
  const candidate = makeShift(body, current, existing || undefined)
  const rows = await allShifts()
  const others = rows.filter((entry) => entry.id !== candidate.id)
  if (others.some((entry) => exactDuplicate(entry, candidate))) {
    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE' }, 409)
  }
  const warnings = others
    .filter((entry) => overlap(entry, candidate))
    .map((entry) => ({ code: 'OVERLAP', shiftId: entry.id, employeeName: entry.employeeName, date: entry.date, start: entry.start, end: entry.end }))
  if (existing) await store().delete(shiftKey(existing))
  await store().setJSON(shiftKey(candidate), candidate)
  return json({ shift: candidate, warnings }, existing ? 200 : 201)
}

async function publishWeek(current: NonNullable<Awaited<ReturnType<typeof actor>>>, week: string) {
  const monday = mondayOf(week)
  const shifts = (await allShifts()).filter((entry) => mondayOf(entry.date) === monday)
  if (!shifts.length) return json({ message: 'Für diese Woche ist kein Entwurf vorhanden.' }, 404)
  const currentVersion = Number(await store().get(`meta/version/${monday}`, { type: 'text' }) || 0)
  const version = currentVersion + 1
  const now = new Date().toISOString()
  for (const shift of shifts) {
    const published: Shift = { ...shift, status: 'published', version, publishedAt: now, publishedBy: current.userId, updatedAt: now, updatedBy: current.userId }
    await store().setJSON(shiftKey(published), published)
  }
  await store().set(`meta/version/${monday}`, String(version))
  await store().setJSON(`versions/${monday}/${version}`, { week: monday, version, publishedAt: now, publishedBy: current.userId, shiftIds: shifts.map((entry) => entry.id) })
  return json({ week: monday, version, published: shifts.length })
}

async function copyPreviousWeek(current: NonNullable<Awaited<ReturnType<typeof actor>>>, targetWeek: string) {
  const targetMonday = mondayOf(targetWeek)
  const target = new Date(`${targetMonday}T12:00:00Z`)
  const previous = new Date(target)
  previous.setUTCDate(previous.getUTCDate() - 7)
  const previousMonday = previous.toISOString().slice(0, 10)
  const source = (await allShifts()).filter((entry) => mondayOf(entry.date) === previousMonday && entry.status === 'published')
  const created: Shift[] = []
  for (const item of source) {
    const date = new Date(`${item.date}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 7)
    const copy = makeShift({ ...item, id: crypto.randomUUID(), date: date.toISOString().slice(0, 10), status: 'draft', version: 0 }, current)
    await store().setJSON(shiftKey(copy), copy)
    created.push(copy)
  }
  return json({ created, sourceWeek: previousMonday, targetWeek: targetMonday }, 201)
}

async function repeatShift(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  const source = await findShift(String(body.id || ''))
  if (!source) return json({ message: 'Der Ausgangsdienst wurde nicht gefunden.' }, 404)
  const dates = Array.isArray(body.dates) ? body.dates.map(String).filter((date) => ISO_DATE.test(date)) : []
  const group = crypto.randomUUID()
  const created: Shift[] = []
  for (const date of dates) {
    const candidate = makeShift({ ...source, id: crypto.randomUUID(), date, status: 'draft', version: 0, repeatGroupId: group }, current)
    const rows = await allShifts()
    if (rows.some((entry) => exactDuplicate(entry, candidate))) continue
    await store().setJSON(shiftKey(candidate), candidate)
    created.push(candidate)
  }
  return json({ created, repeatGroupId: group }, 201)
}

async function upsertObject(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Nur die Administration darf Einsatzort-Koordinaten ändern.' }, 403)
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
  await store().setJSON(`objects/${id}`, site)
  return json({ object: site }, 201)
}

export default async function scheduleV2(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
  const url = new URL(request.url)

  if (request.method === 'GET') {
    const resource = url.searchParams.get('resource') || 'entries'
    if (resource === 'entries') return json({ entries: await getEntries(current, url) })
    if (resource === 'objects') {
      const objects = await readMany<WorkSite>('objects/')
      return json({ objects: objects.map((site) => publicSite(site, MANAGEMENT.has(current.role))) })
    }
    if (resource === 'versions') {
      if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
      return json({ versions: await readMany<Record<string, unknown>>('versions/') })
    }
    if (resource === 'suggestions') {
      if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
      const date = url.searchParams.get('date') || ''
      const start = url.searchParams.get('start') || ''
      const end = url.searchParams.get('end') || ''
      const rows = await allShifts()
      const employees = new Map(rows.map((entry) => [entry.employeeUserId, entry.employeeName]))
      const suggestions = [...employees].map(([employeeUserId, employeeName]) => {
        const conflicts = ISO_DATE.test(date) && TIME.test(start) && TIME.test(end)
          ? rows.filter((entry) => overlap(entry, { employeeUserId, date, start, end }))
          : []
        return { employeeUserId, employeeName, available: conflicts.length === 0, conflicts: conflicts.map((entry) => entry.id) }
      })
      return json({ suggestions })
    }
    return json({ message: 'Unbekannter Dienstplanbereich.' }, 400)
  }

  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || 'save')

  try {
    if (action === 'save') return await saveShift(current, body)
    if (action === 'delete') {
      const existing = await findShift(String(body.id || ''))
      if (!existing) return json({ message: 'Dienst nicht gefunden.' }, 404)
      await store().delete(shiftKey(existing))
      return json({ deleted: true, id: existing.id })
    }
    if (action === 'publish') return await publishWeek(current, String(body.week || body.date || ''))
    if (action === 'copy-previous-week') return await copyPreviousWeek(current, String(body.week || ''))
    if (action === 'repeat') return await repeatShift(current, body)
    if (action === 'object-upsert') return await upsertObject(current, body)
    return json({ message: 'Unbekannte Dienstplanaktion.' }, 400)
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json({ message: error.message }, 400)
    console.error('Habun schedule v2', error)
    return json({ message: 'Der Dienstplan konnte nicht verarbeitet werden.' }, 500)
  }
}

export const config: Config = { path: '/api/schedule-v2' }
