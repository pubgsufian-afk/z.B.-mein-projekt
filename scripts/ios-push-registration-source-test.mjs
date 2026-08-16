import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [client, api, core] = await Promise.all([
  readFile('frontend/src/push-notifications.js', 'utf8'),
  readFile('netlify/functions/push.mts', 'utf8'),
  readFile('netlify/functions/_shared/push-core.mts', 'utf8'),
])

assert.doesNotMatch(client, /Zum Home-Bildschirm|habun-push-ios-guide/, 'normal iPhone browser must not show a persistent push banner')
assert.match(
  client,
  /if \(isIOS\(\) && !isStandalone\(\)\) \{\s*clearPushUi\(\)\s*return\s*\}/,
  'normal iPhone browser must leave push UI hidden',
)
assert.match(client, /action: 'subscribe'[\s\S]*deviceToken: localRegistration\?\.token \|\| ''/, 'every app sync must send the previous local device token')
assert.match(client, /Notification\.permission === 'granted'[\s\S]*ensureSubscription\(registration, false, userId\)[\s\S]*repair: true/, 'granted permission must self-heal or surface a repair button')
assert.match(client, /Erneut verbinden/, 'failed silent sync must expose a visible repair action')

assert.match(api, /const existingToken = String\(body\.deviceToken \|\| ''\)\.trim\(\)/, 'subscribe API must accept the previous device token')
assert.match(api, /registerPushDevice\(actor, endpoint, existingToken\)/, 'subscribe API must pass the previous token to device registration')
assert.match(core, /registerPushDevice\(actor: PortalActor, endpoint: string, existingRawToken = ''\)/, 'device registration must support token reuse')
assert.match(core, /existingRecord\?\.userId === actor\.userId && existingRecord\.endpoint === cleanEndpoint/, 'server must verify token ownership and endpoint before reuse')
assert.match(core, /return \{ deviceToken: cleanToken, reused: true \}/, 'valid device registration must be refreshed without token churn')

console.log('iOS push registration source regression: PASS')
