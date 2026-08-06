import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [helper, endpoint, app] = await Promise.all([
  readFile('netlify/functions/_shared/company-settings.mts', 'utf8'),
  readFile('netlify/functions/company-settings.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])

assert.match(helper, /companyName/)
assert.match(helper, /phone/)
assert.match(helper, /email/)
assert.match(helper, /logoUrl/)
assert.match(helper, /portal-company-settings/)
assert.match(endpoint, /\['owner', 'admin'\]/)
assert.match(endpoint, /verifyRequestOrigin/)
assert.match(endpoint, /path: '\/api\/company-settings'/)
assert.match(app, /Firmendaten wurden gespeichert/)
assert.match(app, /automatisch in neuen PDFs/)

console.log('Company settings tests passed')
