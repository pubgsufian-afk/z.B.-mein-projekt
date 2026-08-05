import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const store = () => getStore({ name: 'portal-schedule-v2', consistency: 'strong' })

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
  const role = owners.has(email)
    ? 'owner'
    : access?.status === 'active' && access.role
      ? access.role
      : ([...(user.roles || []), ...metadata].find((value) => ['owner', 'admin', 'manager', 'employee'].includes(value)) as Role || 'pending')
  return { userId: user.id, role }
}

async function readMany<T>(prefix: string) {
  const listed = await store().list({ prefix })
  const values = await Promise.all(listed.blobs.map((blob) => store().get(blob.key, { type: 'json' }) as Promise<T | null>))
  return values.filter((value): value is T => Boolean(value))
}

function timeMinutes(value: unknown) {
  const [h, m] = String(value || '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function overlaps(left: Record<string, unknown>, right: Record<string, unknown>) {
  const l1 = timeMinutes(left.start), l2 = timeMinutes(left.end), r1 = timeMinutes(right.start), r2 = timeMinutes(right.end)
  return left.employeeUserId === right.employeeUserId && left.date === right.date
    && l1 !== null && l2 !== null && r1 !== null && r2 !== null && l1 < r2 && r1 < l2
}

function monday(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export default async function assist(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const resource = url.searchParams.get('resource') || 'suggestions'
    if (resource === 'templates') return json({ templates: await readMany<Record<string, unknown>>('templates/') })
    const shifts = await readMany<Record<string, unknown>>('shifts/')
    if (resource === 'suggestions') {
      const candidate = { date: url.searchParams.get('date'), start: url.searchParams.get('start'), end: url.searchParams.get('end') }
      const employees = new Map<string, string>()
      for (const shift of shifts) employees.set(String(shift.employeeUserId), String(shift.employeeName || shift.employeeUserId))
      return json({ suggestions: [...employees].map(([employeeUserId, employeeName]) => {
        const conflicts = shifts.filter((shift) => overlaps(shift, { ...candidate, employeeUserId }))
        return { employeeUserId, employeeName, available: conflicts.length === 0, conflicts: conflicts.map((shift) => shift.id) }
      }).sort((a, b) => Number(b.available) - Number(a.available) || a.employeeName.localeCompare(b.employeeName, 'de')) })
    }
    if (resource === 'review') {
      const week = monday(String(url.searchParams.get('week') || new Date().toISOString().slice(0, 10)))
      const weekShifts = shifts.filter((shift) => monday(String(shift.date)) === week)
      const conflicts = []
      for (let i = 0; i < weekShifts.length; i += 1) for (let j = i + 1; j < weekShifts.length; j += 1) {
        if (overlaps(weekShifts[i], weekShifts[j])) conflicts.push({ left: weekShifts[i].id, right: weekShifts[j].id, employeeName: weekShifts[i].employeeName, date: weekShifts[i].date })
      }
      return json({ week, shiftCount: weekShifts.length, draftCount: weekShifts.filter((shift) => shift.status !== 'published').length, conflicts })
    }
    return json({ message: 'Unbekannter Assistenzbereich.' }, 400)
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || '')
  if (action === 'save-template') {
    const name = String(body.name || '').trim()
    if (!name) return json({ message: 'Ein Vorlagenname ist erforderlich.' }, 400)
    const id = String(body.id || crypto.randomUUID())
    const template = {
      id, name,
      start: String(body.start || ''), end: String(body.end || ''), pauseMinutes: Number(body.pauseMinutes || 0),
      location: String(body.location || ''), workArea: String(body.workArea || ''), objectId: String(body.objectId || '') || null,
      note: String(body.note || ''), updatedAt: new Date().toISOString(), updatedBy: current.userId,
    }
    await store().setJSON(`templates/${id}`, template)
    return json({ template }, 201)
  }
  if (action === 'delete-template') {
    await store().delete(`templates/${String(body.id || '')}`)
    return json({ deleted: true })
  }
  return json({ message: 'Unbekannte Aktion.' }, 400)
}

export const config: Config = { path: '/api/schedule-assist-v2' }
