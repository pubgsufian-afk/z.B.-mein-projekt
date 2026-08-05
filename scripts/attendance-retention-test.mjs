import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../netlify/functions/attendance-maintenance.mts', import.meta.url), 'utf8')
assert.match(source, /attendance_locations[\s\S]*expires_at <= now\(\)/)
assert.match(source, /attendance_events[\s\S]*expires_at <= now\(\)/)
assert.match(source, /attendance_legal_holds/)
assert.match(source, /retention-dry-run/)
assert.match(source, /retention-apply/)
assert.match(source, /Nur die Administration darf Aufbewahrungsdaten bereinigen/)

console.log('Attendance retention tests passed · 6 assertions')
