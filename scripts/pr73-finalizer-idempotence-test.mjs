import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const criticalFiles = [
  'netlify/functions/schedule-assistant.mts',
  'netlify/functions/schedule-v2-neon.mts',
]

function applyFinalizer() {
  execFileSync(process.execPath, ['scripts/apply-schedule-assistant-full-control.mjs'], {
    stdio: 'pipe',
    env: process.env,
  })
}

async function snapshot() {
  return Promise.all(criticalFiles.map((path) => readFile(path, 'utf8')))
}

applyFinalizer()
const first = await snapshot()
applyFinalizer()
const second = await snapshot()
assert.deepEqual(second, first, 'critical schedule finalizer must be idempotent on repeated build preparation')

console.log('PR73 critical schedule finalizer idempotence test passed')
