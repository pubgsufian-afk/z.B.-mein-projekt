import fs from 'node:fs'

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const dependency = packageJson.dependencies?.['@netlify/database']
if (!dependency) {
  throw new Error('@netlify/database fehlt in den Abhängigkeiten.')
}

const migrationPath = 'netlify/database/migrations/20260806123000_create-attendance-schema/migration.sql'
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Netlify-Datenbankmigration fehlt: ${migrationPath}`)
}

const migration = fs.readFileSync(migrationPath, 'utf8')
for (const table of [
  'attendance_objects',
  'attendance_events',
  'attendance_locations',
  'attendance_idempotency',
  'attendance_corrections',
  'attendance_correction_decisions',
  'attendance_adjustments',
  'attendance_audit_log',
  'attendance_legal_holds',
]) {
  if (!migration.includes(`CREATE TABLE ${table}`)) {
    throw new Error(`Tabelle fehlt in der Netlify-Migration: ${table}`)
  }
}

if (!migration.includes("'break-start'") || !migration.includes("'break-end'")) {
  throw new Error('Pausenaktionen fehlen in der Netlify-Migration.')
}

console.log('Netlify database configuration test passed')
