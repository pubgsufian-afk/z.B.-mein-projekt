import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(app, /state\.autoCheckoutAt/,
  'the built attendance page must consume the exact server-calculated auto checkout deadline')
assert.match(app, /window\.setTimeout/,
  'the built attendance page must use one local timer instead of backend polling')
assert.match(app, /await\s+load\(\)/,
  'the auto-checkout timer must reuse the existing attendance state load')

console.log('sparse automatic checkout UI applied: ok')
