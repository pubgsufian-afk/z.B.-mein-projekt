import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mapScheduleShiftRow } from '../netlify/functions/_shared/schedule-neon-repository.mts'

const [migration, repository, schedule, legacy, assist, directory, registrations, pdf] = await Promise.all([
  readFile('netlify/database/migrations/20260807160500_create-schedule-schema/migration.sql', 'utf8'),
  readFile('netlify/functions/_shared/schedule-neon-repository.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2-neon.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-assist-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-directory.mts', 'utf8'),
  readFile('netlify/functions/registrations.mts', 'utf8'),
  readFile('netlify/functions/schedule-pdf-fixed.mts', 'utf8'),
])

for (const table of ['schedule_employees', 'schedule_shifts', 'schedule_versions', 'schedule_migrations', 'schedule_audit_log']) {
  assert.ok(migration.includes(`CREATE TABLE ${table}`), `Migration enthält ${table} nicht.`)
}
assert.match(migration, /CREATE UNIQUE INDEX schedule_shifts_exact_duplicate_idx/)
assert.match(migration, /source IN \('portal', 'chatgpt', 'legacy-blob'\)/)
assert.match(migration, /CREATE OR REPLACE FUNCTION portal_publish_chat_shift/)
assert.match(migration, /status = 'active'/)
assert.match(migration, /RETURN QUERY SELECT 'duplicate'::text/)
assert.match(migration, /RETURN QUERY SELECT 'published'::text/)
assert.match(migration, /'shift-published'/)
assert.match(migration, /'chatgpt'/)
assert.match(migration, /p_pause_minutes integer DEFAULT 0/)

assert.match(repository, /from '@netlify\/database'/)
assert.match(repository, /findExactScheduleDuplicate/)
assert.match(repository, /publishScheduleWeek/)
assert.match(repository, /syncScheduleEmployees/)
assert.match(repository, /writeScheduleAudit/)

assert.match(schedule, /path: '\/api\/schedule-v2'/)
assert.match(schedule, /publishedOnly: true/)
assert.match(schedule, /employeeUserId: current\.userId/)
assert.match(schedule, /ensureLegacyScheduleMigrated/)
assert.match(schedule, /syncActiveEmployees/)
assert.match(schedule, /action === 'object-delete'/)
assert.match(schedule, /EXACT_DUPLICATE/)
assert.match(legacy, /path: '\/api\/schedule-v2-blob-legacy'/)
assert.match(assist, /loadSharedSchedule\(request\)/)
assert.match(directory, /syncScheduleEmployees/)
assert.match(registrations, /upsertScheduleEmployee/)
assert.match(pdf, /new URL\('\/api\/schedule-v2'/)

const mapped = mapScheduleShiftRow({
  id: 'shift-1', employee_user_id: 'employee-1', employee_name: 'Test Mitarbeiter',
  shift_date: '2026-08-07', start_time: '07:00:00', end_time: '17:00:00', pause_minutes: 0,
  object_id: null, location: 'Abbott', work_area: 'ZuKo', note: '', status: 'published', version: 1,
  template_id: null, repeat_group_id: null, created_at: '2026-08-07T05:00:00.000Z', created_by: 'admin',
  updated_at: '2026-08-07T05:00:00.000Z', updated_by: 'admin', published_at: '2026-08-07T05:00:00.000Z',
  published_by: 'admin', source: 'chatgpt', source_ref: 'chat:test',
})
assert.equal(mapped.employeeUserId, 'employee-1')
assert.equal(mapped.start, '07:00')
assert.equal(mapped.location, 'Abbott')
assert.equal(mapped.status, 'published')
assert.equal(mapped.source, 'chatgpt')

console.log('Shared Neon schedule source tests passed')
