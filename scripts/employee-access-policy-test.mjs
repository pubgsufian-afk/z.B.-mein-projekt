import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, styles, attendance, service, maintenance, schedule, legacyWork, index] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
  readFile('netlify/functions/attendance.mts', 'utf8'),
  readFile('netlify/functions/_shared/attendance-service.mts', 'utf8'),
  readFile('netlify/functions/attendance-maintenance.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/work.mts', 'utf8'),
  readFile('public/index.html', 'utf8'),
])

assert.match(app, /\{ key: 'attendance', label: 'Zeiterfassung', roles: \['owner', 'admin', 'manager', 'employee'\] \}/)
for (const key of ['overview', 'schedule', 'times', 'corrections']) {
  assert.doesNotMatch(app, new RegExp(`key: '${key}'[^\n]+employee`), `Mitarbeiter darf ${key} nicht in der Navigation erhalten.`)
}
assert.match(app, /employee-kiosk-shell/)
assert.match(app, /session\.role === 'employee' \? 'attendance' : 'overview'/)
assert.match(app, /employeeOnly/)
assert.match(app, /!employeeOnly && <section className="panel">/)
assert.match(app, /brand-mark/)
assert.match(styles, /env\(safe-area-inset-top\)/)
assert.match(styles, /env\(safe-area-inset-bottom\)/)
assert.match(styles, /employee-kiosk-shell/)
assert.match(styles, /brand-mark/)
assert.match(index, /viewport-fit=cover/)

assert.match(service, /getHistory[\s\S]*?if \(!MANAGEMENT_ROLES\.has\(current\.role\)\) throw new AttendanceServiceError\('Keine Berechtigung\.', 403, 'FORBIDDEN'\)/)
assert.match(attendance, /resource === 'history'[\s\S]*?actor\.role === 'employee'[\s\S]*?FORBIDDEN/)
assert.match(attendance, /getStore\(\{ name: 'portal-schedule-v2'/)
assert.doesNotMatch(attendance, /fetchScheduleEndpoint/)
assert.match(maintenance, /if \(!MANAGEMENT\.has\(current\.role\)\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(schedule, /if \(!MANAGEMENT\.has\(current\.role\)\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(legacyWork, /queryResource === "schedule"[\s\S]*?!MANAGEMENT_ROLES\.includes\(current\.role\)[\s\S]*?Keine Berechtigung/)

console.log('Employee kiosk access policy tests passed')
