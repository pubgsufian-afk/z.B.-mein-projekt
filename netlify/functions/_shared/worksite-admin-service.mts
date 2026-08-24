import { getStore } from '@netlify/blobs'
import { databaseConnectionString } from './database-connection.mts'
import { resolveGoogleMapsLocation } from './google-maps-location.mts'
import { listScheduleShifts } from './schedule-neon-repository.mts'

export type WorksiteAdminActor = { userId: string; role: 'owner' | 'admin' }
export type WorksiteAdminInput = {
  id: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  accuracyMeters: number | null
  radiusMeters: number
}

export class WorksiteAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'WORKSITE_ADMIN_ERROR') {
    super(message)
    this.name = 'WorksiteAdminError'
    this.status = status
    this.code = code
  }
}

function text(value: unknown, max = 600) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

export function normalizeWorksiteInput(raw: Record<string, unknown>): WorksiteAdminInput {
  const id = text(raw.id, 300) || crypto.randomUUID()
  const name = text(raw.name, 300)
  const address = text(raw.address, 600)
  const latitude = raw.latitude === '' || raw.latitude == null ? null : Number(raw.latitude)
  const longitude = raw.longitude === '' || raw.longitude == null ? null : Number(raw.longitude)
  const hasCoordinates = latitude !== null || longitude !== null
  const complete = latitude !== null && longitude !== null
  if (!name) throw new WorksiteAdminError('Der Name des Einsatzortes ist erforderlich.', 400, 'NAME_REQUIRED')
  if (hasCoordinates && !complete) throw new WorksiteAdminError('Breiten- und Längengrad müssen gemeinsam angegeben werden.', 400, 'COORDINATES_INCOMPLETE')
  if ((latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) || (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))) {
    throw new WorksiteAdminError('Die Koordinaten sind ungültig.', 400, 'INVALID_COORDINATES')
  }
  const accuracyMeters = complete
    ? Math.max(0, Number.isFinite(Number(raw.accuracyMeters)) ? Number(raw.accuracyMeters) : 0)
    : null
  const radiusMeters = Number(raw.radiusMeters ?? 500)
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0 || radiusMeters > 10000) {
    throw new WorksiteAdminError('Der Prüfradius ist ungültig.', 400, 'INVALID_RADIUS')
  }
  return { id, name, address, latitude, longitude, accuracyMeters, radiusMeters }
}

function store() {
  return getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
}

async function syncAttendanceObject(site: WorksiteAdminInput, actorId: string) {
  const url = databaseConnectionString()
  if (!url) return false
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(url)
  await sql(
    `INSERT INTO attendance_objects (id, latitude, longitude, accuracy_meters, radius_meters, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,now(),$6)
     ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
       accuracy_meters = EXCLUDED.accuracy_meters, radius_meters = EXCLUDED.radius_meters,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [site.id, site.latitude, site.longitude, site.accuracyMeters, site.radiusMeters, actorId],
  )
  return true
}

export function createWorksiteAdminService() {
  return {
    async listWorksites(_actor: WorksiteAdminActor) {
      const listed = await store().list({ prefix: 'objects/' })
      const rows = await Promise.all(listed.blobs.map((blob) => store().get(blob.key, { type: 'json' }) as Promise<Record<string, unknown> | null>))
      return rows.filter(Boolean)
    },
    async getWorksite(_actor: WorksiteAdminActor, id: string) {
      const key = text(id, 300)
      if (!key) throw new WorksiteAdminError('Der Einsatzort fehlt.', 400, 'WORKSITE_REQUIRED')
      const row = await store().get(`objects/${key}`, { type: 'json' }) as Record<string, unknown> | null
      if (!row) throw new WorksiteAdminError('Der Einsatzort wurde nicht gefunden.', 404, 'WORKSITE_NOT_FOUND')
      return row
    },
    async saveWorksite(actor: WorksiteAdminActor, raw: Record<string, unknown>) {
      const input = normalizeWorksiteInput(raw)
      const object = { ...input, updatedAt: new Date().toISOString(), updatedBy: actor.userId }
      await store().setJSON(`objects/${input.id}`, object)
      const databaseSynced = await syncAttendanceObject(input, actor.userId)
      return { object, databaseSynced }
    },
    async deleteWorksite(_actor: WorksiteAdminActor, id: string) {
      const key = text(id, 300)
      if (!key) throw new WorksiteAdminError('Der Einsatzort fehlt.', 400, 'WORKSITE_REQUIRED')
      const existing = await store().get(`objects/${key}`, { type: 'json' }) as Record<string, unknown> | null
      if (!existing) throw new WorksiteAdminError('Der Einsatzort wurde nicht gefunden.', 404, 'WORKSITE_NOT_FOUND')
      const referenced = (await listScheduleShifts()).filter((shift) => shift.objectId === key).length
      await store().delete(`objects/${key}`)
      return { deleted: true, id: key, scheduleReferenceCount: referenced }
    },
    async resolveGoogleMapsWorksite(_actor: WorksiteAdminActor, url: string) {
      try {
        return await resolveGoogleMapsLocation(text(url, 2000))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Der Google-Maps-Link konnte nicht verarbeitet werden.'
        throw new WorksiteAdminError(message, /Koordinaten/.test(message) ? 422 : 400, 'MAP_RESOLVE_FAILED')
      }
    },
  }
}

export function worksiteAdminService() {
  return createWorksiteAdminService()
}
