import { readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const functionsDir = 'netlify/functions'
for (const name of await readdir(functionsDir)) {
  if (name.startsWith('audit-pipeline-') && name.endsWith('.mts')) await rm(`${functionsDir}/${name}`)
}

const checks = [
  ['admin-time', 'node', ['scripts/admin-time-test.mjs']],
  ['schedule-multi', 'node', ['scripts/schedule-multi-test.mjs']],
  ['attendance-v2', 'node', ['scripts/attendance-v2-verify.mjs']],
  ['portal-fixes', 'node', ['scripts/apply-portal-audit-fixes.mjs']],
  ['support-patch', 'node', ['scripts/apply-scheduler-support.mjs']],
  ['support-regressions', 'node', ['scripts/fix-scheduler-patch-regressions.mjs']],
  ['unified-portal', 'node', ['scripts/unified-portal-test.mjs']],
  ['employee-policy', 'node', ['scripts/employee-access-policy-test.mjs']],
  ['support-policy', 'node', ['scripts/scheduler-support-test.mjs']],
  ['attendance-pause', 'node', ['scripts/attendance-pause-test.mjs']],
  ['company-settings', 'node', ['scripts/company-settings-test.mjs']],
  ['pdf-branding', 'node', ['scripts/pdf-branding-test.mjs']],
  ['report-download', 'node', ['scripts/report-download-contract-test.mjs']],
  ['schedule-pdf', 'node', ['scripts/schedule-pdf-test.mjs']],
  ['employee-schedule', 'node', ['scripts/employee-schedule-compact-test.mjs']],
  ['portal-regression', 'node', ['scripts/portal-audit-regression-test.mjs']],
  ['report-production', 'node', ['scripts/report-production-v2-test.mjs']],
  ['database-config', 'node', ['scripts/netlify-database-config-test.mjs']],
  ['frontend-build', 'node', ['scripts/build-frontend.mjs']],
  ['dist-build', 'node', ['scripts/build.mjs']],
]

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  })
}

async function marker(name, payload) {
  await writeFile(`${functionsDir}/${name}.mts`, `import type { Config } from '@netlify/functions'\nexport default async () => Response.json(${JSON.stringify(payload)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\nexport const config: Config = { path: '/api/${name}' }\n`)
}

let failed = null
for (const [label, command, args] of checks) {
  const result = run(command, args)
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  console.log(`AUDIT ${label}: ${result.status === 0 ? 'OK' : 'FAILED'}`)
  if (output) console.log(output)
  if (result.status !== 0) {
    failed = { label, exitCode: result.status, details: output.slice(-10000) }
    break
  }
}

if (!failed) {
  const browser = run('node', ['scripts/run-netlify-browser-audit.mjs'])
  const output = `${browser.stdout || ''}\n${browser.stderr || ''}`.trim()
  console.log(`AUDIT browser: ${browser.status === 0 ? 'OK' : 'FAILED'}`)
  if (output) console.log(output)
  if (browser.status !== 0) failed = { label: 'browser-runner', exitCode: browser.status, details: output.slice(-10000) }
}

if (failed) await marker(`audit-pipeline-failed-${failed.label}`, failed)
else await marker('audit-pipeline-complete', { success: true })
