import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile('netlify/database/migrations/20260812090000_fix-adel-august-pauses/migration.sql', 'utf8')

assert.match(migration, /IF schedule_rows = 0 AND schedule_dates = 0[\s\S]*timesheet_rows = 0 AND timesheet_dates = 0 THEN/)
assert.match(migration, /RAISE NOTICE[\s\S]*RETURN;/)
assert.match(migration, /IF schedule_rows <> 4 OR schedule_dates <> 4 THEN/)
assert.match(migration, /IF timesheet_rows <> 4 OR timesheet_dates <> 4 THEN/)

console.log('empty preview Adel migration guard test passed')
