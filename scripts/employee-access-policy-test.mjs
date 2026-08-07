import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, styles, logoStyles, main, sessionEndpoint, attendance, service, maintenance, schedule, legacyWork, companySettings, registrations, legacySettings, index] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
  readFile('frontend/src/logo-visibility.css', 'utf8'),
  readFile('frontend/src/main.jsx', 'utf8'),
  readFile('netlify/functions/session.mts', 'utf8'),
  readFile('netlify/functions/attendance.mts', 'utf8'),
  readFile('netlify/functions/_shared/attendance-service.mts', 'utf8'),
  readFile('netlify/functions/attendance-maintenance.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/work.mts', 'utf8'),
  readFile('netlify/functions/company-settings.mts', 'utf8'),
  readFile('netlify/functions/registrations.mts', 'utf8'),
  readFile('netlify/functions/settings.mts', 'utf8'),
  readFile('public/index.html', 'utf8'),
])

assert.match(app, /\{ key: 'attendance', label: 'Zeiterfassung', roles: \['owner', 'admin', 'manager', 'employee'\] \}/)
assert.match(app, /\{ key: 'schedule', label: 'Dienstplan', roles: \['owner', 'admin', 'manager', 'scheduler', 'employee'\] \}/)
for (const key of ['overview', 'times', 'corrections']) {
  assert.doesNotMatch(app, new RegExp(`key: '${key}'[^\n]+employee`), `Mitarbeiter darf ${key} nicht in der Navigation erhalten.`)
}
assert.match(app, /employee-kiosk-shell/)
assert.match(app, /employee-kiosk-nav/)
assert.match(app, /const employeeSessionUserId = session\.userId \|\| session\.id/)
assert.match(app, /String\(entry\.employeeUserId \|\| ''\) === String\(employeeSessionUserId \|\| ''\) && entry\.status === 'published'/)
assert.match(app, /session\.role === 'employee' \? 'attendance' : session\.role === 'scheduler' \? 'schedule' : 'overview'/)
assert.match(app, /employeeOnly/)
assert.match(app, /!employeeOnly && <section className="panel">/)
assert.match(app, /brand-mark/)
assert.match(styles, /env\(safe-area-inset-top\)/)
assert.match(styles, /env\(safe-area-inset-bottom\)/)
assert.match(styles, /employee-kiosk-shell/)
assert.match(styles, /brand-mark/)
assert.match(main, /logo-visibility\.css/)
assert.match(logoStyles, /position:\s*absolute/)
assert.match(logoStyles, /transform:\s*translate\(-50%,\s*-50%\)/)
assert.match(logoStyles, /employee-kiosk-header \.brand-mark[\s\S]*?width:\s*76px[\s\S]*?height:\s*76px/)
assert.match(index, /viewport-fit=cover/)

assert.match(sessionEndpoint, /data\.role === ['"]employee['"]/)
assert.match(sessionEndpoint, /userId:\s*data\.userId\s*\|\|\s*data\.id/)
assert.doesNotMatch(sessionEndpoint, /employeeCount:\s*data\.employeeCount/)
assert.match(service, /getHistory[\s\S]*?if \(!MANAGEMENT_ROLES\.has\(current\.role\)\) throw new AttendanceServiceError\('Keine Berechtigung\.', 403, 'FORBIDDEN'\)/)
assert.match(attendance, /resource === 'history'[\s\S]*?actor\.role === 'employee'[\s\S]*?FORBIDDEN/)
assert.match(attendance, /getStore\(\{ name: 'portal-schedule-v2'/)
assert.doesNotMatch(attendance, /fetchScheduleEndpoint/)
assert.match(maintenance, /if \(!MANAGEMENT\.has\(current\.role\)\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(schedule, /resource === 'entries'[\s\S]*?getEntries\(current, url\)/)
assert.match(schedule, /entry\.employeeUserId === current\.userId && entry\.status === 'published'/)
assert.match(schedule, /resource === 'entries'[\s\S]*?if \(!SCHEDULING\.has\(current\.role\)\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(legacyWork, /currentAccess[\s\S]*?!MANAGEMENT_ROLES\.includes\(currentAccess\.role\)[\s\S]*?Keine Berechtigung/)
assert.match(companySettings, /if \(!\['owner', 'admin'\]\.includes\(current\.role\)\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(registrations, /requirePortalRole\(\['owner', 'admin', 'manager'\]\)/)
assert.match(legacySettings, /requirePortalRole\(\['owner', 'admin'\]\)/)

console.log('Employee kiosk access policy tests passed')
