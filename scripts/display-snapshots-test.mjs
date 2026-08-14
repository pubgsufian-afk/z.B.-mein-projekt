import assert from 'node:assert/strict'
import {
  clearDisplaySnapshots,
  invalidateDisplaySnapshots,
  peekDisplaySnapshot,
  setDisplaySnapshot,
} from '../frontend/src/display-snapshots.js'

clearDisplaySnapshots()
assert.equal(peekDisplaySnapshot('overview:today'), undefined)

setDisplaySnapshot('overview:today', { count: 3 }, 30000)
assert.deepEqual(peekDisplaySnapshot('overview:today'), { count: 3 })

setDisplaySnapshot('schedule:2026-08-10', { entries: [1] }, 30000)
setDisplaySnapshot('schedule:2026-08-17', { entries: [2] }, 30000)
invalidateDisplaySnapshots((key) => key.startsWith('schedule:'))
assert.equal(peekDisplaySnapshot('schedule:2026-08-10'), undefined)
assert.equal(peekDisplaySnapshot('schedule:2026-08-17'), undefined)

setDisplaySnapshot('expired', { value: true }, 0)
assert.equal(peekDisplaySnapshot('expired'), undefined)

clearDisplaySnapshots()
assert.equal(peekDisplaySnapshot('overview:today'), undefined)

console.log('display-snapshots-test: PASS')
