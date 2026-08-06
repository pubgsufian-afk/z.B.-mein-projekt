import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const functionFiles = [
  'netlify/functions/attendance.mts',
  'netlify/functions/schedule-v2.mts',
  'netlify/functions/schedule-assist-v2.mts',
  'netlify/functions/attendance-maintenance.mts',
  'netlify/functions/reports-v2.mts',
  'netlify/functions/worksite-v2.mts',
  'netlify/functions/company-settings.mts',
  'netlify/functions/unified-reports.mts',
]

await build({
  entryPoints: [path.join(root, 'frontend/src/main.jsx')],
  outdir: path.join(root, '.unified-portal-check'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  logLevel: 'warning',
})

await build({
  entryPoints: functionFiles.map((file) => path.join(root, file)),
  outdir: path.join(root, '.attendance-v2-check'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
  external: [
    '@netlify/functions',
    '@netlify/blobs',
    '@netlify/identity',
    '@neondatabase/serverless',
    'pdf-lib',
    'exceljs',
  ],
})

const index = await readFile(path.join(root, 'public/index.html'), 'utf8')
const app = await readFile(path.join(root, 'frontend/src/App.jsx'), 'utf8')
assert.match(index, /assets\/habun-portal\.js/, 'Unified portal bundle missing from index.html')
assert.match(index, /assets\/habun-portal\.css/, 'Unified portal stylesheet missing from index.html')
assert.doesNotMatch(index, /attendance-v2\.js|attendance-v2-compat\.js|Neue Zeiterfassung|Zeiterfassung und Planung/, 'Legacy second portal is still installed')
assert.match(index, /habun-logo|apple-touch-icon|favicon/, 'Existing brand assets must remain installed')
assert.doesNotMatch(app, /Mitarbeiter-ID|Personalnummer/i, 'Employee ID must not be rendered by the unified source')

const tests = [
  'scripts/attendance-domain-test.mjs',
  'scripts/attendance-api-contract-test.mjs',
  'scripts/attendance-handler-test.mjs',
  'scripts/attendance-repository-test.mjs',
  'scripts/schedule-v2-test.mjs',
  'scripts/schedule-assist-v2-test.mjs',
  'scripts/worksite-v2-test.mjs',
  'scripts/attendance-corrections-test.mjs',
  'scripts/attendance-retention-test.mjs',
  'scripts/reports-v2-test.mjs',
]
for (const test of tests) execFileSync(process.execPath, [path.join(root, test)], { stdio: 'inherit' })

console.log(`Unified attendance verification passed · 1 React application · ${functionFiles.length} functions · ${tests.length} compatibility suites`)
