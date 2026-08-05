import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/attendance-v2.js', import.meta.url), 'utf8')
const compat = await readFile(new URL('../public/attendance-v2-compat.js', import.meta.url), 'utf8')

assert.match(source, /habun-attendance-state-v2/)
assert.match(source, /habun-attendance-queue-v2/)
assert.match(source, /createClientEventId\(\)/)
assert.match(source, /enqueueAttendanceEvent/)
assert.match(source, /sortPendingEvents/)
assert.match(source, /shouldRefreshSession/)
assert.match(source, /navigator\.geolocation\.getCurrentPosition/)
assert.doesNotMatch(source, /watchPosition/)
assert.match(source, /Arbeitsbeginn.*Arbeitsende/s)
assert.doesNotMatch(source, /Pause starten|Pause beenden/)
assert.match(source, /Automatische Pause/)
assert.match(compat, /Pause starten\|Pause beenden/)
assert.match(compat, /button\.hidden = true/)

console.log('Attendance UI tests passed · 13 assertions')
