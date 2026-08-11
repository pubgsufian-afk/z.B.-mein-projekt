import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8')
const editor = await readFile(new URL('../frontend/src/employee-role-management-auto.js', import.meta.url), 'utf8')
const cache = await readFile(new URL('../frontend/src/read-cache.js', import.meta.url), 'utf8')

assert.match(app, /from '\.\/read-cache\.js'/)
assert.match(app, /REGISTRATIONS_CACHE_KEY/)
assert.match(app, /peekCachedJson\(REGISTRATIONS_CACHE_KEY\)/)
assert.match(app, /refreshCachedJson\(\s*REGISTRATIONS_CACHE_KEY/)
assert.match(app, /clearReadCache\(\)/)
assert.match(app, /data-user-id=\{employee\.userId \|\| employee\.id\}/)

assert.match(app, /const shiftPath = `\/api\/schedule-v2\?resource=entries&from=\$\{from\}&to=\$\{to\}`/)
assert.match(app, /const shiftRequest = dedupeInflightJson\(shiftPath, \(\) => apiJson\(shiftPath\)\)/)
assert.match(app, /const auxiliaryRequest = Promise\.all\(\[/)
const shiftRequestIndex = app.indexOf('const shiftRequest = dedupeInflightJson(shiftPath')
const earlyEntriesIndex = app.indexOf('setEntries(shiftData.entries || [])', shiftRequestIndex)
const auxiliaryAwaitIndex = app.indexOf(';[objectData, employeeData] = await auxiliaryRequest', shiftRequestIndex)
assert.ok(shiftRequestIndex >= 0 && earlyEntriesIndex > shiftRequestIndex && auxiliaryAwaitIndex > earlyEntriesIndex, 'Dienstplan-Einträge müssen vor den Editor-Verzeichnissen gerendert werden.')
assert.doesNotMatch(app, /refreshCachedJson\([^)]*resource=entries/)
assert.doesNotMatch(app, /refreshCachedJson\([^)]*\/api\/attendance/)
assert.doesNotMatch(app, /refreshCachedJson\([^)]*unified-reports/)
assert.doesNotMatch(app, /refreshCachedJson\([^)]*schedule-pdf/)

assert.match(editor, /habun:employee-snapshot/)
assert.match(editor, /snapshotEmployees/)
assert.match(editor, /card\.dataset\.userId/)
assert.doesNotMatch(editor, /employees\[index\]/)
assert.match(editor, /invalidateCachedJson\('\/api\/registrations'\)/)

assert.doesNotMatch(cache, /localStorage|sessionStorage|indexedDB|IndexedDB/)
assert.doesNotMatch(cache, /\/api\/session|\/api\/attendance|schedule-pdf|unified-reports/)

console.log('safe-performance-loading-source-test: PASS')
