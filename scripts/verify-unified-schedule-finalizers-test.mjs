import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-attendance-schedule-source-fix.mjs')

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const command = String(packageJson.scripts?.['verify:unified'] || '')
const overnightPatch = await readFile('scripts/apply-overnight-shift-attendance-fix.mjs', 'utf8')

const safeRoleIndex = command.lastIndexOf('node scripts/apply-safe-employee-role-loading.mjs')
const worksiteFinalizerIndex = command.lastIndexOf('node scripts/apply-worksite-delete-feature.mjs')
const overnightFinalizerIndex = command.lastIndexOf('node scripts/apply-overnight-shift-attendance-fix.mjs')
const firstSourceTestIndex = command.indexOf('node scripts/safe-performance-loading-source-test.mjs')

assert.ok(safeRoleIndex >= 0, 'Safe-role patch is missing from verify:unified.')
assert.ok(firstSourceTestIndex > safeRoleIndex, 'Unified source tests must run after the patch phase.')
assert.ok(
  worksiteFinalizerIndex > safeRoleIndex && worksiteFinalizerIndex < firstSourceTestIndex,
  'The worksite finalizer must run at the end of the patch phase.',
)
assert.ok(
  overnightFinalizerIndex > worksiteFinalizerIndex && overnightFinalizerIndex < firstSourceTestIndex,
  'The overnight finalizer must run after the worksite finalizer and before source tests.',
)
assert.match(overnightPatch, /alreadyAppliedVariants/, 'The overnight finalizer must accept its optimized output on repeated runs.')
assert.match(overnightPatch, /const rawEntries = await repository\.listEvents\(userId\)/)

const attendanceSource = await readFile('netlify/functions/attendance.mts', 'utf8')
assert.match(attendanceSource, /await import\('\.\/_shared\/schedule-neon-repository\.mts'\)/)

console.log('Unified schedule finalizer order test passed')
