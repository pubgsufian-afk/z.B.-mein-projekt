import { access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const tests = [
  ['scripts/portal-admin-command-test.mjs', true],
  ['scripts/portal-admin-router-test.mjs', true],
  ['scripts/portal-admin-capability-registry-test.mjs', true],
  ['scripts/portal-admin-adapter-source-test.mjs', false],
  ['scripts/portal-admin-oidc-source-test.mjs', false],
  ['scripts/schedule-oidc-workflow-source-test.mjs', false],
  ['scripts/attendance-admin-service-test.mjs', true],
  ['scripts/timesheet-create-source-test.mjs', false],
  ['scripts/admin-time-editing-test.mjs', false],
  ['scripts/attendance-assistant-source-test.mjs', false],
  ['scripts/portal-admin-history-test.mjs', true],
  ['scripts/portal-admin-bulk-attendance-test.mjs', false],
  ['scripts/portal-admin-history-rebind-test.mjs', false],
  ['scripts/portal-admin-history-rebind-audit-test.mjs', false],
  ['scripts/portal-admin-client-planner-test.mjs', false],
  ['scripts/portal-admin-bulk-schedule-test.mjs', false],
  ['scripts/portal-admin-schedule-attendance-integration-test.mjs', false],
  ['scripts/portal-admin-attendance-maintenance-test.mjs', false],
  ['scripts/portal-admin-timesheets-test.mjs', false],
  ['scripts/portal-admin-schedule-assist-test.mjs', false],
  ['scripts/employee-admin-service-test.mjs', false],
  ['scripts/portal-admin-employee-test.mjs', false],
  ['scripts/worksite-admin-service-test.mjs', false],
  ['scripts/portal-admin-worksite-test.mjs', false],
  ['scripts/portal-admin-company-test.mjs', false],
  ['scripts/registration-admin-service-test.mjs', false],
  ['scripts/portal-admin-domain-integration-test.mjs', false],
  ['scripts/portal-admin-export-envelope-test.mjs', true],
  ['scripts/portal-admin-export-spool-source-test.mjs', false],
  ['scripts/portal-admin-report-service-test.mjs', false],
  ['scripts/portal-admin-reports-adapter-test.mjs', false],
  ['scripts/portal-admin-export-transport-test.mjs', false],
  ['scripts/portal-admin-daily-report-test.mjs', false],
  ['scripts/portal-admin-surface-coverage-test.mjs', false],
  ['scripts/netlify-build-routing-test.mjs', false],
]

for (const [path] of tests) await access(path)

for (const [path, stripTypes] of tests) {
  const args = [...(stripTypes ? ['--experimental-strip-types'] : []), path]
  process.stdout.write(`\n[portal-admin] ${path}\n`)
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log(`\nportal admin full verification passed (${tests.length} tests)`)
