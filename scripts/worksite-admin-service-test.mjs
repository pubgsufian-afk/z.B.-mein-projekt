import assert from 'node:assert/strict'
import { normalizeWorksiteInput } from '../netlify/functions/_shared/worksite-admin-service.mts'

assert.deepEqual(normalizeWorksiteInput({
  id: 'site-1', name: 'Abbott', address: 'Straße 1', latitude: 52.4, longitude: 9.7, radiusMeters: 500,
}), {
  id: 'site-1', name: 'Abbott', address: 'Straße 1', latitude: 52.4, longitude: 9.7, accuracyMeters: 0, radiusMeters: 500,
})
assert.throws(() => normalizeWorksiteInput({ name: '', radiusMeters: 500 }), /Name/)
assert.throws(() => normalizeWorksiteInput({ name: 'A', latitude: 52, longitude: null, radiusMeters: 500 }), /gemeinsam/)
assert.throws(() => normalizeWorksiteInput({ name: 'A', latitude: 91, longitude: 9, radiusMeters: 500 }), /Koordinaten/)
assert.throws(() => normalizeWorksiteInput({ name: 'A', radiusMeters: 10001 }), /Prüfradius/)

console.log('worksite admin service tests passed')
