import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, migration] = await Promise.all([
  readFile('netlify/functions/_shared/employee-history-rebind.mts', 'utf8'),
  readFile('netlify/database/migrations/20260806123000_create-attendance-schema/migration.sql', 'utf8'),
])

const constraint = migration.match(/attendance_audit_log_after_data_keys_check CHECK \([\s\S]*?ARRAY\[([^\]]+)\]/)
assert.ok(constraint, 'attendance audit key constraint not found')
assert.match(constraint[1], /'note'/, 'attendance audit constraint must allow note')
assert.doesNotMatch(constraint[1], /'targetUserId'|'eventCount'|'locationCount'|'adjustmentCount'/)

const marker = source.indexOf("'admin-employee-rebind'")
assert.ok(marker >= 0, 'history rebind audit write not found')
const auditSection = source.slice(marker, source.indexOf('return { eventCount', marker))
assert.match(auditSection, /const auditBefore = \{ note:/, 'rebind audit before payload must use an allowed key')
assert.match(auditSection, /const auditAfter = \{ note:/, 'rebind audit after payload must use an allowed key')
assert.match(auditSection, /JSON\.stringify\(auditBefore\)/)
assert.match(auditSection, /JSON\.stringify\(auditAfter\)/)

console.log('portal admin history rebind audit constraint test passed')
