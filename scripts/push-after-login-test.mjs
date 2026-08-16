import fs from 'node:fs'

const source = fs.readFileSync(new URL('../frontend/src/push-notifications.js', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../frontend/src/push-notifications.css', import.meta.url), 'utf8')
const setupBlock = source.match(/async function setupForCurrentSession\(\)[\s\S]*?export async function installPushNotifications/)?.[0] || ''
const iosIndex = setupBlock.indexOf('if (isIOS() && !isStandalone())')
const capabilityIndex = setupBlock.indexOf('if (!pushSupported()) return')
const iosCardBlock = source.match(/if \(isIOS\(\) && !isStandalone\(\)\) \{[\s\S]*?\} else if/)?.[0] || ''

const checks = [
  ["imports onAuthChange", source.includes("import { onAuthChange } from '@netlify/identity'")],
  ['listens for auth changes', source.includes('onAuthChange(async (_event, currentUser)')],
  ['clears stale push UI on logout', source.includes('clearPushUi()')],
  ['re-runs setup after login', source.includes('await setupForCurrentSession()')],
  ['validates active portal roles', source.includes('ACTIVE_PORTAL_ROLES.has(String(session.role))')],
  ['shows explicit iPhone Home Screen guidance', source.includes("card.classList.add('habun-push-ios-guide')")],
  ['checks iPhone guidance before push capability', iosIndex >= 0 && capabilityIndex >= 0 && iosIndex < capabilityIndex],
  ['iPhone browser guide has no blocking button', Boolean(iosCardBlock) && !iosCardBlock.includes('<button')],
  ['admin push labels do not collide with Ende field', !source.includes('Benachrichtigung senden')],
  ['push guidance itself never intercepts portal taps', /\.habun-push-card\{[^}]*pointer-events:none/.test(css)],
  ['interactive push buttons stay clickable', /\.habun-push-card button\{[^}]*pointer-events:auto/.test(css)],
]
const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
if (failed.length) process.exit(1)
