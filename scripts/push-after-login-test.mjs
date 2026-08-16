import fs from 'node:fs'

const source = fs.readFileSync(new URL('../frontend/src/push-notifications.js', import.meta.url), 'utf8')
const checks = [
  ["imports onAuthChange", source.includes("import { onAuthChange } from '@netlify/identity'")],
  ['listens for auth changes', source.includes('onAuthChange(async (_event, currentUser)')],
  ['clears stale push UI on logout', source.includes('clearPushUi()')],
  ['re-runs setup after login', source.includes('await setupForCurrentSession()')],
]
const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
if (failed.length) process.exit(1)
