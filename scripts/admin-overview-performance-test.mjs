import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('frontend/src/AdminOverview.jsx', 'utf8')

assert.match(source, /from '\.\/display-snapshots\.js'/)
assert.match(source, /const \[scheduleLoaded, setScheduleLoaded\]/)
assert.match(source, /const \[liveLoaded, setLiveLoaded\]/)
assert.match(source, /Promise\.allSettled\(/)
assert.match(source, /peekDisplaySnapshot\(/)
assert.match(source, /setDisplaySnapshot\(/)
assert.match(source, /loading=\{!scheduleLoaded \|\| !liveLoaded\}/)
assert.match(source, /loading \? '…' : entries\.length/)
assert.doesNotMatch(source, /await apiJson\(`\/api\/schedule-v2[\s\S]*?await apiJson\(`\/api\/attendance\?resource=live/)

console.log('admin-overview-performance-test: PASS')
