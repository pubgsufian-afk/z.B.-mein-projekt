import { getStore } from '@netlify/blobs'
import { upsertScheduleEmployee, type ScheduleEmployee } from './schedule-neon-repository.mts'

export type RegistrationAdminRole = 'owner' | 'admin'

type RegistrationRecord = {
  id?: string
  status?: string
  role?: string
  fullName?: string
  employeeId?: string
  company?: string
  location?: string
  createdAt?: string
  decidedAt?: string
  decidedBy?: string
}

type AccessRecord = {
  userId: string
  role: 'employee' | 'manager' | 'admin' | 'pending'
  status: 'active' | 'rejected'
  fullName?: string
  employeeId?: string
  company?: string
  location?: string
  grantedAt: string
  grantedBy: string
}

const ALLOWED_ROLES = new Set(['employee', 'manager', 'admin'])

function registrationsStore() {
  return getStore({ name: 'portal-registrations', consistency: 'strong' })
}

function accessStore() {
  return getStore({ name: 'portal-access', consistency: 'strong' })
}

function clean(value: unknown, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

export async function listPendingRegistrations() {
  const store = registrationsStore()
  const listed = await store.list({ prefix: 'registration/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<RegistrationRecord | null>),
  )
  return rows
    .filter((item): item is RegistrationRecord => Boolean(item && item.status === 'pending'))
    .sort((left, right) => clean(right.createdAt).localeCompare(clean(left.createdAt)))
    .map((item) => ({
      id: clean(item.id),
      status: 'pending',
      fullName: clean(item.fullName),
      employeeId: clean(item.employeeId),
      company: clean(item.company),
      location: clean(item.location),
      createdAt: clean(item.createdAt),
    }))
}

export async function decideRegistration(input: {
  id: string
  action: 'approve' | 'reject'
  role?: string
  actorId: string
  actorRole: RegistrationAdminRole
}) {
  const id = clean(input.id, 200)
  if (!id) throw new TypeError('Registrierungs-ID fehlt.')
  const store = registrationsStore()
  const key = `registration/${id}`
  const registration = await store.get(key, { type: 'json' }) as RegistrationRecord | null
  if (!registration || registration.status !== 'pending') {
    return { ok: false as const, status: 404, code: 'NOT_FOUND' }
  }

  const now = new Date().toISOString()
  const actorId = clean(input.actorId, 200) || 'portal-admin-relay'

  if (input.action === 'reject') {
    const decided: RegistrationRecord = {
      ...registration,
      status: 'rejected',
      decidedAt: now,
      decidedBy: actorId,
    }
    const access: AccessRecord = {
      userId: id,
      role: 'pending',
      status: 'rejected',
      fullName: clean(registration.fullName),
      employeeId: clean(registration.employeeId),
      company: clean(registration.company),
      location: clean(registration.location),
      grantedAt: now,
      grantedBy: actorId,
    }
    await Promise.all([
      store.setJSON(key, decided),
      accessStore().setJSON(`access/${id}`, access),
    ])
    return { ok: true as const, action: 'reject' as const, id }
  }

  const role = clean(input.role || 'employee', 30)
  if (!ALLOWED_ROLES.has(role)) throw new TypeError('Ungültige Rolle.')
  if (role === 'admin' && input.actorRole !== 'owner') {
    return { ok: false as const, status: 403, code: 'OWNER_REQUIRED', message: 'Nur der Hauptadmin darf weitere Admins bestimmen.' }
  }

  const decided: RegistrationRecord = {
    ...registration,
    status: 'approved',
    role,
    decidedAt: now,
    decidedBy: actorId,
  }
  const access: AccessRecord = {
    userId: id,
    role: role as AccessRecord['role'],
    status: 'active',
    fullName: clean(registration.fullName),
    employeeId: clean(registration.employeeId),
    company: clean(registration.company),
    location: clean(registration.location),
    grantedAt: now,
    grantedBy: actorId,
  }
  await Promise.all([
    store.setJSON(key, decided),
    accessStore().setJSON(`access/${id}`, access),
  ])
  if (access.fullName) {
    await upsertScheduleEmployee({
      userId: access.userId,
      fullName: access.fullName,
      role: role as ScheduleEmployee['role'],
      status: 'active',
      location: access.location || '',
    })
  }
  return { ok: true as const, action: 'approve' as const, employee: access, role }
}
