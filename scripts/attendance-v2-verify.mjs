import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserFiles = [
  'public/attendance-core.js',
  'public/attendance-v2.js',
  'public/attendance-v2-compat.js',
  'public/attendance-corrections-tab.js',
  'public/live-attendance.js',
  'public/schedule-v2.js',
  'public/schedule-assist-v2.js',
  'public/attendance-corrections.js',
  'public/reports-v2.js',
  'public/worksite-v2.js',
]
const functionFiles = [
  'netlify/functions/attendance.mts',
  'netlify/functions/schedule-v2.mts',
  'netlify/functions/schedule-assist-v2.mts',
  'netlify/functions/attendance-maintenance.mts',
  'netlify/functions/reports-v2.mts',
  'netlify/functions/worksite-v2.mts',
]

for (const file of browserFiles) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' })

await build({
  entryPoints: functionFiles.map((file) => path.join(root, file)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
  external: ['@netlify/functions', '@netlify/blobs', '@netlify/identity', '@neondatabase/serverless', 'pdf-lib'],
})

const index = await readFile(path.join(root, 'public/index.html'), 'utf8')
for (const file of ['attendance-v2.js', 'attendance-corrections-tab.js', 'live-attendance.js', 'schedule-v2.js', 'schedule-assist-v2.js', 'attendance-corrections.js', 'reports-v2.js', 'worksite-v2.js']) {
  assert.match(index, new RegExp(file.replace('.', '\\.')), `${file} missing from index.html`)
}
assert.match(index, /habun-logo|apple-touch-icon|favicon/, 'Existing brand assets must remain installed')

const tests = [
  'scripts/attendance-baseline-test.mjs',
  'scripts/attendance-domain-test.mjs',
  'scripts/attendance-client-test.mjs',
  'scripts/attendance-api-contract-test.mjs',
  'scripts/attendance-handler-test.mjs',
  'scripts/attendance-repository-test.mjs',
  'scripts/attendance-ui-test.mjs',
  'scripts/live-attendance-test.mjs',
  'scripts/schedule-v2-test.mjs',
  'scripts/schedule-assist-v2-test.mjs',
  'scripts/worksite-v2-test.mjs',
  'scripts/attendance-corrections-test.mjs',
  'scripts/attendance-retention-test.mjs',
  'scripts/reports-v2-test.mjs',
]
for (const test of tests) execFileSync(process.execPath, [path.join(root, test)], { stdio: 'inherit' })

console.log(`Attendance V2 verification passed · ${browserFiles.length} browser files · ${functionFiles.length} functions · ${tests.length} test suites`)
