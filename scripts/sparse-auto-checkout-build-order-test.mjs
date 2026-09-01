import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [fullWorkflow, tddWorkflow, buildFrontend] = await Promise.all([
  readFile('.github/workflows/attendance-feature-full-verify.yml', 'utf8'),
  readFile('.github/workflows/attendance-auto-checkout-tdd.yml', 'utf8'),
  readFile('scripts/build-frontend.mjs', 'utf8'),
])

assert.doesNotMatch(
  fullWorkflow,
  /Apply sparse checkout UI after existing source finalizers|run:\s*node scripts\/apply-sparse-attendance-auto-checkout\.mjs/,
  'the sparse UI patch must not mutate App.jsx before npm run build repeats the legacy finalizers',
)
assert.doesNotMatch(
  tddWorkflow,
  /run:\s*node scripts\/apply-sparse-attendance-auto-checkout\.mjs/,
  'the focused TDD workflow must test the patch source without mutating App.jsx first',
)

const refreshIndex = buildFrontend.indexOf("apply-attendance-refresh-auto-checkout.mjs")
const sparseIndex = buildFrontend.indexOf("apply-sparse-attendance-auto-checkout.mjs")
assert.ok(refreshIndex >= 0, 'frontend build must keep the existing attendance refresh finalizer')
assert.ok(sparseIndex > refreshIndex, 'sparse auto-checkout UI must be the final attendance patch before compilation')

console.log('sparse auto-checkout build order: ok')
