import assert from 'node:assert/strict'
import {
  clearReadCache,
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
assert.equal(calls, 1, 'gleichzeitige identische GETs müssen dedupliziert werden')
release({ employees: [{ userId: 'e2' }] })
assert.deepEqual(await p1, { employees: [{ userId: 'e2' }] })
assert.deepEqual(await p2, { employees: [{ userId: 'e2' }] })
assert.deepEqual(peekCachedJson('/api/registrations'), { employees: [{ userId: 'e2' }] })

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

console.log('read-cache-test: PASS')
