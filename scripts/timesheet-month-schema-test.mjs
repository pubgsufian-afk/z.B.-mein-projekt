import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile('netlify/database/migrations/20260811233000_create-timesheet-monthly-snapshots/migration.sql', 'utf8')
for (const needle of [
  'CREATE TABLE timesheet_months',
  'month_key text PRIMARY KEY',
  'correction_deadline date NOT NULL',
  'CREATE TABLE timesheet_entries',
  'schedule_shift_id text',
  'manual_override boolean NOT NULL DEFAULT false',
  "source text NOT NULL DEFAULT 'schedule'",
  'CREATE UNIQUE INDEX timesheet_entries_schedule_shift_idx',
  'CREATE TABLE timesheet_audit_log',
]) assert.ok(sql.includes(needle), `missing ${needle}`)

console.log('timesheet month schema contract passed')
