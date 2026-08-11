import { getStore } from '@netlify/blobs'
import {
  hasScheduleMigration,
  markScheduleMigration,
  upsertScheduleShift,
  upsertScheduleVersion,
  writeScheduleAudit,
  type ScheduleShift,
} from './schedule-neon-repository.mts'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const LEGACY_MIGRATION_KEY = 'portal-schedule-v2-blobs-v1'

function legacyScheduleStore() {
  return getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
}

async function readBlobMany<T>(prefix: string): Promise<T[]> {
  const store = legacyScheduleStore()
  const listed = await store.list({ prefix })
  const rows = await Promise.all(
    listed.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<T | null>),
  )
  return rows.filter((row): row is T => Boolean(row))
}

export async function ensureLegacyScheduleMigrated() {
  if (await hasScheduleMigration(LEGACY_MIGRATION_KEY)) return

  const legacyShifts = await readBlobMany<Record<string, unknown>>('shifts/')
  let migrated = 0
  for (const row of legacyShifts) {
    const required = ['id', 'employeeUserId', 'employeeName', 'date', 'start', 'end', 'location', 'workArea']
    if (required.some((field) => !String(row[field] || '').trim())) continue

    const now = new Date().toISOString()
    const shift: ScheduleShift = {
      id: String(row.id),
      employeeUserId: String(row.employeeUserId),
      employeeName: String(row.employeeName),
      date: String(row.date),
      start: String(row.start),
      end: String(row.end),
      pauseMinutes: Math.max(0, Math.round(Number(row.pauseMinutes || 0))),
      objectId: String(row.objectId || '').trim() || null,
      location: String(row.location),
      workArea: String(row.workArea),
      note: String(row.note || ''),
      status: row.status === 'published' ? 'published' : 'draft',
      version: Number(row.version || 0),
      templateId: String(row.templateId || '').trim() || null,
      repeatGroupId: String(row.repeatGroupId || '').trim() || null,
      createdAt: String(row.createdAt || now),
      createdBy: String(row.createdBy || 'legacy'),
      updatedAt: String(row.updatedAt || row.createdAt || now),
      updatedBy: String(row.updatedBy || row.createdBy || 'legacy'),
      publishedAt: row.publishedAt ? String(row.publishedAt) : null,
      publishedBy: row.publishedBy ? String(row.publishedBy) : null,
      source: 'legacy-blob',
      sourceRef: `blob:shifts/${String(row.id)}`,
    }

    try {
      await upsertScheduleShift(shift)
      migrated += 1
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || '')
      if (code !== '23505') throw error
    }
  }

  const legacyVersions = await readBlobMany<Record<string, unknown>>('versions/')
  for (const row of legacyVersions) {
    if (!ISO_DATE.test(String(row.week || '')) || !Number(row.version)) continue
    await upsertScheduleVersion({
      week: String(row.week),
      version: Number(row.version),
      publishedAt: String(row.publishedAt || new Date().toISOString()),
      publishedBy: String(row.publishedBy || 'legacy'),
      shiftIds: Array.isArray(row.shiftIds) ? row.shiftIds.map(String) : [],
    })
  }

  await markScheduleMigration(LEGACY_MIGRATION_KEY, {
    migratedShifts: migrated,
    legacyShiftCount: legacyShifts.length,
  })
  await writeScheduleAudit({
    actorId: 'migration',
    actorType: 'migration',
    action: 'legacy-blob-import-complete',
    details: { migratedShifts: migrated, legacyShiftCount: legacyShifts.length },
  })
}
