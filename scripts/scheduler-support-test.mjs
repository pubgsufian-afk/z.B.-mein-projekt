import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, roles, session, schedule, assist, directory, schedulePdf] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('netlify/functions/_shared/portal-role.mts', 'utf8'),
  readFile('netlify/functions/session.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-assist-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-directory.mts', 'utf8'),
  readFile('netlify/functions/schedule-pdf-fixed.mts', 'utf8'),
])

assert.match(app, /scheduler: 'Dienstplan-Support'/)
assert.match(app, /const SCHEDULING = new Set\(\[\.\.\.MANAGEMENT, 'scheduler'\]\)/)
assert.match(app, /key: 'schedule'[^\n]+scheduler/)
for (const key of ['overview', 'attendance', 'employees', 'times', 'worksites', 'corrections', 'reports', 'settings']) {
  assert.doesNotMatch(app, new RegExp(`key: '${key}'[^\\n]+scheduler`), `Dienstplan-Support darf ${key} nicht sehen.`)
}
assert.match(app, /session\.role === 'scheduler' \? 'schedule'/)
assert.match(app, /session\.role === 'scheduler' \? '\/api\/schedule-directory'/)
assert.match(app, /MANAGEMENT\.has\(session\.role\) && <button[^>]+onClick=\{downloadSchedulePdf\}/)

assert.match(roles, /PortalRole = 'owner' \| 'admin' \| 'manager' \| 'scheduler'/)
assert.match(roles, /PORTAL_SCHEDULER_EMAILS/)
assert.match(session, /local\?\.role === 'scheduler'/)
assert.match(session, /role: 'scheduler'/)
assert.doesNotMatch(session, /employeeCount:[^\n]+scheduler/)

assert.match(schedule, /const SCHEDULING = new Set<Role>\(\[\.\.\.MANAGEMENT, 'scheduler'\]\)/)
assert.match(schedule, /if \(!SCHEDULING\.has\(current\.role\)\)/)
assert.match(schedule, /Nur die Administration darf Einsatzort-Koordinaten ändern/)
assert.match(assist, /const SCHEDULING = new Set<Role>\(\[\.\.\.MANAGEMENT, 'scheduler'\]\)/)
assert.match(assist, /if \(!SCHEDULING\.has\(current\.role\)\)/)

assert.match(directory, /\['owner', 'admin', 'manager', 'scheduler'\]/)
assert.match(directory, /status === 'active'/)
assert.doesNotMatch(directory, /email:/)
assert.doesNotMatch(schedulePdf, /scheduler/)

console.log('Scheduler support policy tests passed')
