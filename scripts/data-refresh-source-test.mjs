import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-data-refresh.mjs')

const [refresh, hook, main, sw, app, timesheet, monthly, adminOverview] = await Promise.all([
  readFile('frontend/src/data-refresh.js', 'utf8'),
  readFile('frontend/src/use-data-refresh.js', 'utf8'),
  readFile('frontend/src/main.jsx', 'utf8'),
  readFile('frontend/public/push-sw.js', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/AdminOverview.jsx', 'utf8'),
])

assert.match(refresh, /habun:data-refresh/)
assert.match(refresh, /visibilitychange/)
assert.match(refresh, /pageshow/)
assert.match(refresh, /focus/)
assert.match(refresh, /serviceWorker/)
assert.match(refresh, /PORTAL_DATA_CHANGED/)
assert.doesNotMatch(refresh, /localStorage|sessionStorage|indexedDB|location\.reload/)
assert.match(main, /installDataRefreshTriggers\(/)
assert.match(sw, /PORTAL_DATA_CHANGED/)
assert.match(sw, /clients\.matchAll/)
assert.match(sw, /client\.postMessage/)

assert.match(hook, /subscribeDataRefresh/)
assert.match(hook, /runningRef/)
assert.match(hook, /refreshRef/)
assert.doesNotMatch(hook, /setInterval|location\.reload/)
assert.match(app, /from '\.\/use-data-refresh\.js'/)
assert.match(app, /useDataRefresh\(load\)/)
assert.match(timesheet, /from '\.\/use-data-refresh\.js'/)
assert.match(timesheet, /useDataRefresh\(reload\)/)
assert.match(monthly, /from '\.\/use-data-refresh\.js'/)
assert.match(monthly, /useDataRefresh\(loadTimesheet\)/)
assert.match(adminOverview, /from '\.\/use-data-refresh\.js'/)
assert.match(adminOverview, /useDataRefresh\(/)

console.log('data refresh source contract: ok')
