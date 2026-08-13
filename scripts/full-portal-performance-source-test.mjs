import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import './apply-full-portal-berlin-date-fix.mjs'

const [app, timesheet, cache, netlify] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
  readFile('frontend/src/read-cache.js', 'utf8'),
  readFile('netlify.toml', 'utf8'),
])

// Global render efficiency.
assert.match(app, /const DATE_FORMATTERS = new Map\(\)/)
assert.match(app, /function DigitalClock\(\)/)
assert.match(app, /const \[now, setNow\] = useState\(\(\) => new Date\(\)\)/)
const attendanceStart = app.indexOf('function AttendancePage({ session }) {')
const attendanceEnd = app.indexOf('\nfunction EmployeesPage', attendanceStart)
const attendanceBlock = app.slice(attendanceStart, attendanceEnd)
assert.doesNotMatch(attendanceBlock, /const \[now, setNow\]/)
assert.doesNotMatch(attendanceBlock, /setInterval\(/)
assert.match(app, /behavior: 'auto'/)

// Overview must only request today's Berlin-local schedule rows.
const overviewStart = app.indexOf('function OverviewPage({ session, navigate }) {')
const overviewEnd = app.indexOf('\nfunction DigitalClock', overviewStart)
const overviewBlock = app.slice(overviewStart, overviewEnd)
assert.match(overviewBlock, /const today = berlinDateKey\(\)/)
assert.doesNotMatch(overviewBlock, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/)
assert.match(app, /const schedulePath = `\/api\/schedule-v2\?resource=entries&from=\$\{today\}&to=\$\{today\}`/)
assert.match(app, /dedupeInflightJson\(schedulePath, \(\) => apiJson\(schedulePath\)\)/)
assert.doesNotMatch(app, /const calls = \[apiJson\('\/api\/schedule-v2\?resource=entries'\)/)

// Dynamic reads are in-flight only, never completed-value cached.
assert.match(cache, /export async function dedupeInflightJson/)
assert.match(app, /dedupeInflightJson\('\/api\/attendance\?resource=state'/)
assert.match(app, /dedupeInflightJson\('\/api\/attendance\?resource=live'/)
assert.doesNotMatch(cache, /primeCachedJson\(cacheKey, value[^\n]*dedupeInflightJson/)

// Stable directories/configuration use cached-then-fresh behavior.
assert.match(app, /const OBJECTS_CACHE_KEY = '\/api\/schedule-v2\?resource=objects'/)
assert.match(app, /const COMPANY_SETTINGS_CACHE_KEY = '\/api\/company-settings'/)
assert.match(app, /peekCachedJson\(OBJECTS_CACHE_KEY\)/)
assert.match(app, /refreshCachedJson\(OBJECTS_CACHE_KEY/)
assert.match(app, /invalidateCachedJson\(OBJECTS_CACHE_KEY\)/)
assert.match(app, /peekCachedJson\(COMPANY_SETTINGS_CACHE_KEY\)/)
assert.match(app, /refreshCachedJson\(COMPANY_SETTINGS_CACHE_KEY/)
assert.match(app, /invalidateCachedJson\(COMPANY_SETTINGS_CACHE_KEY\)/)

// Reports and employee-driven pages reuse registration directory.
const reportsStart = app.indexOf('function ReportsPage() {')
const reportsEnd = app.indexOf('\nfunction SettingsPage', reportsStart)
const reportsBlock = app.slice(reportsStart, reportsEnd)
assert.match(reportsBlock, /peekCachedJson\(REGISTRATIONS_CACHE_KEY\)/)
assert.match(reportsBlock, /refreshCachedJson\(REGISTRATIONS_CACHE_KEY/)

// Schedule management renders/group rows efficiently and keeps entries fresh.
const scheduleStart = app.indexOf('function SchedulePage({ session }) {')
const scheduleEnd = app.indexOf('\nfunction buildSessions', scheduleStart)
const scheduleBlock = app.slice(scheduleStart, scheduleEnd)
assert.match(scheduleBlock, /const entriesByDate = useMemo/)
assert.match(scheduleBlock, /entriesByDate\.get\(date\) \|\| \[\]/)
assert.doesNotMatch(scheduleBlock, /visibleEntries\.filter\(\(entry\) => entry\.date === date\)/)
assert.match(scheduleBlock, /dedupeInflightJson\(shiftPath/)
assert.match(scheduleBlock, /refreshCachedJson\(OBJECTS_CACHE_KEY/)

// Timesheet uses safe performance primitives without refetching all data when the employee directory arrives.
assert.match(timesheet, /from '\.\/read-cache\.js'/)
assert.match(timesheet, /const DATE_FORMATTERS = new Map\(\)/)
assert.match(timesheet, /BERLIN_TIME_INPUT_FORMATTER/)
assert.match(timesheet, /peekCachedJson\(REGISTRATIONS_CACHE_KEY\)/)
assert.match(timesheet, /refreshCachedJson\(REGISTRATIONS_CACHE_KEY/)
assert.match(timesheet, /dedupeInflightJson\(historyPath/)
assert.match(timesheet, /dedupeInflightJson\(schedulePath/)
assert.match(timesheet, /const employeeNamesRef = useRef\(employeeNames\)/)
assert.match(timesheet, /employeeNamesRef\.current = employeeNames/)
assert.match(timesheet, /buildActualSessions\(data\.entries \|\| \[\], employeeNamesRef\.current\)/)
assert.match(timesheet, /buildPlannedRows\(entries, employeeNamesRef\.current\)/)
assert.match(timesheet, /setActual\(\(current\) => rebindEmployeeNames\(current, employeeNames\)\)/)
assert.match(timesheet, /setPlanned\(\(current\) => rebindEmployeeNames\(current, employeeNames\)\)/)

// Fingerprinted frontend assets are immutable browser-cacheable resources.
assert.match(netlify, /for = "\/assets\/\*"[\s\S]*Cache-Control = "public, max-age=31536000, immutable"/)

// No forbidden browser persistence was introduced.
assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|IndexedDB/)
assert.doesNotMatch(timesheet, /localStorage|sessionStorage|indexedDB|IndexedDB/)
assert.doesNotMatch(cache, /localStorage|sessionStorage|indexedDB|IndexedDB/)

console.log('full-portal-performance-source-test: PASS')
