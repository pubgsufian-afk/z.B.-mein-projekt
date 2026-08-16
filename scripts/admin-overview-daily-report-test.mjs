import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(root, 'frontend/src/App.jsx')
const componentPath = resolve(root, 'frontend/src/AdminOverview.jsx')
const utilsPath = resolve(root, 'frontend/src/admin-overview-utils.mjs')
const cssPath = resolve(root, 'frontend/src/admin-overview.css')
const apiPath = resolve(root, 'netlify/functions/daily-reports.mts')
const modelPath = resolve(root, 'netlify/functions/_shared/daily-report-model.mts')
const applyPath = resolve(root, 'scripts/apply-admin-overview-daily-report.mjs')
const pushPath = resolve(root, 'frontend/src/push-notifications.js')

assert.equal(existsSync(componentPath), true, 'AdminOverview.jsx must exist')
assert.equal(existsSync(utilsPath), true, 'admin-overview-utils.mjs must exist')
assert.equal(existsSync(cssPath), true, 'admin-overview.css must exist')
assert.equal(existsSync(apiPath), true, 'daily-reports.mts must exist')
assert.equal(existsSync(modelPath), true, 'daily-report-model.mts must exist')
assert.equal(existsSync(applyPath), true, 'overview apply script must exist')
assert.equal(existsSync(pushPath), true, 'push notification client must exist')

const app = readFileSync(appPath, 'utf8')
const component = readFileSync(componentPath, 'utf8')
const utils = readFileSync(utilsPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')
const api = readFileSync(apiPath, 'utf8')
const model = readFileSync(modelPath, 'utf8')
const apply = readFileSync(applyPath, 'utf8')
const push = readFileSync(pushPath, 'utf8')

assert.match(app, /AdminOverview/, 'App.jsx must be wired to AdminOverview after applying the patch')
assert.doesNotMatch(app.match(/function OverviewPage[\s\S]*?function DigitalClock/)?.[0] || '', /Meine Zeiten/, 'old Meine Zeiten shortcut must be absent from overview')
assert.doesNotMatch(app.match(/function OverviewPage[\s\S]*?function DigitalClock/)?.[0] || '', /PDF und Excel erstellen/, 'old report shortcut must be absent from overview')

for (const label of ['Einsatz-Zentrale', 'Tagesbericht', 'Bericht schreiben', 'Berichte öffnen', 'Nur für Admin']) {
  assert.match(component, new RegExp(label), `AdminOverview must render ${label}`)
}
assert.match(component, /ADMINISTRATION\.has\(session\.role\)/, 'admin UI must be guarded by owner/admin roles')
assert.match(component, /1000/, 'UI must enforce the 1,000 word limit')
assert.match(component, /aria-expanded/, 'status groups must be expandable/collapsible')
assert.match(component, /\/api\/attendance\?resource=live/, 'command center must use live attendance data')
assert.match(component, /\/api\/schedule-v2\?resource=entries/, 'command center must use schedule data')
assert.match(component, /\/api\/daily-reports/, 'daily report UI must use the daily report API')

assert.match(utils, /export function buildDeploymentGroups/, 'utils must expose staff grouping')
assert.match(utils, /clock-in/, 'utils must map clock-in')
assert.match(utils, /break-start/, 'utils must map break-start')
assert.match(utils, /break-end/, 'utils must map break-end')
assert.match(utils, /clock-out/, 'utils must map clock-out')
assert.match(utils, /Europe\/Berlin/, 'date helper must use Europe/Berlin')

const { buildDeploymentGroups, countReportWords } = await import(pathToFileURL(utilsPath).href)
assert.equal(countReportWords('  Eins zwei\n drei  '), 3, 'word counter must ignore surrounding/repeated whitespace')
const groups = buildDeploymentGroups(
  [
    { id: 's1', date: '2026-08-14', employeeUserId: 'u1', employeeName: 'Aras', status: 'published' },
    { id: 's2', date: '2026-08-14', employeeUserId: 'u1', employeeName: 'Aras', status: 'published' },
    { id: 's3', date: '2026-08-14', employeeUserId: 'u2', employeeName: 'Adel', status: 'published' },
    { id: 's4', date: '2026-08-14', employeeUserId: 'u3', employeeName: 'Amin', status: 'published' },
    { id: 's5', date: '2026-08-14', employeeUserId: 'u4', employeeName: 'Kwame', status: 'published' },
    { id: 'draft', date: '2026-08-14', employeeUserId: 'u5', employeeName: 'Draft', status: 'draft' },
  ],
  [
    { userId: 'u1', action: 'clock-in', clientOccurredAt: '2026-08-14T06:00:00Z', eventDate: '2026-08-14' },
    { userId: 'u2', action: 'break-start', clientOccurredAt: '2026-08-14T10:00:00Z', eventDate: '2026-08-14' },
    { userId: 'u3', action: 'clock-in', clientOccurredAt: '2026-08-14T07:00:00Z', eventDate: '2026-08-14' },
    { userId: 'u3', action: 'clock-out', clientOccurredAt: '2026-08-14T16:00:00Z', eventDate: '2026-08-14' },
  ],
  '2026-08-14',
)
assert.deepEqual(groups.working.map((entry) => entry.name), ['Aras'], 'clock-in maps to Im Dienst and duplicate shifts are deduped')
assert.deepEqual(groups.paused.map((entry) => entry.name), ['Adel'], 'break-start maps to In Pause')
assert.deepEqual(groups.completed.map((entry) => entry.name), ['Amin'], 'latest clock-out maps to Dienst beendet')
assert.deepEqual(groups.notStarted.map((entry) => entry.name), ['Kwame'], 'missing attendance maps to Noch nicht gestartet')

assert.match(api, /requirePortalRole\(\['owner', 'admin'\]\)/, 'API must be owner/admin only')
assert.match(api, /reportStore/, 'API must use the shared daily report store helper')
assert.match(model, /portal-daily-reports/, 'shared model must keep the dedicated lightweight blob store')
assert.match(api, /MAX_REPORT_WORDS\s*=\s*1000/, 'API must enforce the 1,000 word limit')
assert.match(api, /verifyRequestOrigin/, 'POST must verify request origin')
assert.match(api, /createdAt/, 'API must create server-side timestamps')
assert.match(api, /authorName/, 'API must save server-derived author names')

assert.match(css, /admin-command-center/, 'command center styles must exist')
assert.match(css, /daily-report/, 'daily report styles must exist')
assert.match(css, /@media/, 'mobile/responsive styles must exist')

assert.match(apply, /function OverviewPage/, 'apply script must patch only the overview function')
assert.match(apply, /AdminOverview/, 'apply script must inject AdminOverview')

const installPush = push.match(/export async function installPushNotifications\(\)[\s\S]*$/)?.[0] || ''
const iosPreflightIndex = installPush.indexOf('isIOS() && !isStandalone()')
const unsupportedReturnIndex = installPush.indexOf('if (!pushSupported()) return')
assert.ok(iosPreflightIndex >= 0, 'iPhone browser path must explicitly show the Home Screen instruction')
assert.ok(unsupportedReturnIndex < 0 || iosPreflightIndex < unsupportedReturnIndex, 'iPhone Home Screen instruction must run before unsupported-browser early return')

console.log('admin overview + daily report source contract: ok')
