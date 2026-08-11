import assert from 'node:assert/strict'
import {
  clearReadCache,
  dedupeInflightJson,
  invalidateCachedJson,
  peekCachedJson,
  primeCachedJson,
  refreshCachedJson,
} from '../frontend/src/read-cache.js'

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

primeCachedJson('/api/registrations', { employees: [{ userId: 'e1' }] }, 30000)
assert.deepEqual(peekCachedJson('/api/registrations'), { employees: [{ userId: 'e1' }] })

invalidateCachedJson('/api/registrations')
assert.equal(peekCachedJson('/api/registrations'), undefined)

let calls = 0
let release
const loader = () => {
  calls += 1
  return new Promise((resolve) => { release = resolve })
}
const p1 = refreshCachedJson('/api/registrations', loader, { ttlMs: 30000 })
const p2 = refreshCachedJson('/api/registrations', loader, { ttlMs: 30000 })
assert.equal(calls, 1, 'gleichzeitige identische Cache-GETs müssen dedupliziert werden')
release({ employees: [{ userId: 'e2' }] })
assert.deepEqual(await p1, { employees: [{ userId: 'e2' }] })
assert.deepEqual(await p2, { employees: [{ userId: 'e2' }] })
assert.deepEqual(peekCachedJson('/api/registrations'), { employees: [{ userId: 'e2' }] })

let dynamicCalls = 0
let releaseDynamic
const dynamicLoader = () => {
  dynamicCalls += 1
  return new Promise((resolve) => { releaseDynamic = resolve })
}
const d1 = dedupeInflightJson('/api/attendance?resource=state', dynamicLoader)
const d2 = dedupeInflightJson('/api/attendance?resource=state', dynamicLoader)
assert.equal(dynamicCalls, 1, 'gleichzeitig laufende dynamische GETs müssen geteilt werden')
releaseDynamic({ phase: 'working' })
assert.deepEqual(await d1, { phase: 'working' })
assert.deepEqual(await d2, { phase: 'working' })
assert.equal(peekCachedJson('/api/attendance?resource=state'), undefined, 'dynamische GETs dürfen keinen fertigen Snapshot speichern')

const d3 = await dedupeInflightJson('/api/attendance?resource=state', async () => {
  dynamicCalls += 1
  return { phase: 'paused' }
})
assert.equal(dynamicCalls, 2, 'ein späterer dynamischer GET muss erneut den Loader ausführen')
assert.deepEqual(d3, { phase: 'paused' })

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

console.log('read-cache-test: PASS')
