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

const scheduleMigrationPath = 'netlify/database/migrations/20260807160500_create-schedule-schema/migration.sql'
if (!fs.existsSync(scheduleMigrationPath)) {
  throw new Error(`Dienstplan-Datenbankmigration fehlt: ${scheduleMigrationPath}`)
}
const scheduleMigration = fs.readFileSync(scheduleMigrationPath, 'utf8')
for (const table of ['schedule_employees', 'schedule_shifts', 'schedule_versions', 'schedule_migrations', 'schedule_audit_log']) {
  if (!scheduleMigration.includes(`CREATE TABLE ${table}`)) {
    throw new Error(`Dienstplan-Tabelle fehlt in der Netlify-Migration: ${table}`)
  }
}
if (!scheduleMigration.includes('schedule_shifts_exact_duplicate_idx')) {
  throw new Error('Datenbankseitiger Duplikatschutz für Dienstpläne fehlt.')
}

const helperPath = 'netlify/functions/_shared/database-connection.mts'
if (!fs.existsSync(helperPath)) {
  throw new Error('Gemeinsame Laufzeit-Datenbankverbindung fehlt.')
}
const helper = fs.readFileSync(helperPath, 'utf8')
if (!helper.includes("from '@netlify/database'") || !helper.includes('getConnectionString')) {
  throw new Error('Die offizielle Netlify-Laufzeitverbindung wird nicht verwendet.')
}

const scheduleRepositoryPath = 'netlify/functions/_shared/schedule-neon-repository.mts'
if (!fs.existsSync(scheduleRepositoryPath)) throw new Error('Dienstplan-Datenbankrepository fehlt.')
const scheduleRepository = fs.readFileSync(scheduleRepositoryPath, 'utf8')
if (!scheduleRepository.includes("from '@netlify/database'") || !scheduleRepository.includes('getDatabase')) {
  throw new Error('Dienstplan nutzt nicht die offizielle Netlify-Datenbankverbindung.')
}

for (const functionPath of [
  'netlify/functions/attendance.mts',
  'netlify/functions/attendance-maintenance.mts',
  'netlify/functions/reports-v2.mts',
  'netlify/functions/unified-reports.mts',
  'netlify/functions/worksite-v2.mts',
]) {
  const source = fs.readFileSync(functionPath, 'utf8')
  if (!source.includes("from './_shared/database-connection.mts'")) {
    throw new Error(`${functionPath} nutzt die gemeinsame Netlify-Datenbankverbindung nicht.`)
  }
}

console.log('Netlify database configuration test passed')
