import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [refresh, main, sw] = await Promise.all([
  readFile('frontend/src/data-refresh.js', 'utf8'),
  readFile('frontend/src/main.jsx', 'utf8'),
  readFile('frontend/public/push-sw.js', 'utf8'),
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

console.log('data refresh source contract: ok')
