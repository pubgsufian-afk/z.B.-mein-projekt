import assert from 'node:assert/strict'
import { minimalDateChunks, changedRowsOnly } from './portal-admin-client-planner.mjs'

assert.deepEqual(minimalDateChunks('2026-08-01', '2026-08-24', 62), [
  { from: '2026-08-01', to: '2026-08-24' },
])
assert.deepEqual(minimalDateChunks('2026-01-01', '2026-08-24', 62), [
  { from: '2026-01-01', to: '2026-03-03' },
  { from: '2026-03-04', to: '2026-05-04' },
  { from: '2026-05-05', to: '2026-07-05' },
  { from: '2026-07-06', to: '2026-08-24' },
])
assert.throws(() => minimalDateChunks('2026-08-24', '2026-08-01', 62), /Zeitraum/)
assert.throws(() => minimalDateChunks('2026-08-01', '2026-08-24', 0), /Chunk/)

assert.deepEqual(changedRowsOnly([
  { id: 'a', before: { pauseMinutes: 30 }, after: { pauseMinutes: 30 } },
  { id: 'b', before: { pauseMinutes: 0 }, after: { pauseMinutes: 30 } },
  { id: 'c', before: { start: '08:00', end: '16:00' }, after: { end: '16:00', start: '08:00' } },
]).map((row) => row.id), ['b'])

console.log('portal admin client planner tests passed')
