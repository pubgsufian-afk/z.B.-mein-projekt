import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-session-expiry-fix.mjs')

const app = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(app, /response\.status === 401/)
assert.match(app, /habun:auth-expired/)
assert.match(app, /setIdentityUser\(null\)/)
assert.match(app, /setSession\(null\)/)
assert.match(app, /Sitzung abgelaufen\. Bitte erneut anmelden\./)
assert.doesNotMatch(app, /catch \(error\) \{ setNotice\(\{ tone: 'error', text: error\.message \}\) \}\s*finally \{ setLoading\(false\) \}/, '401 must not leave a stale authenticated portal visible')

console.log('session expiry source contract: ok')
