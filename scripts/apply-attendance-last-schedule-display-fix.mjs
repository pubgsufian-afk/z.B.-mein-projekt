import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const attendancePath = 'netlify/functions/attendance.mts'
let attendance = await readFile(attendancePath, 'utf8')

const oldFallback = `  const today = plannedSchedules(entries, userId, date)\n  return today.at(-1) || null\n}`
const newFallback = `  const today = plannedSchedules(entries, userId, date)\n  if (today.length) return today.at(-1) || null\n  const previous = bounded\n    .filter((item) => item.bounds.endStamp < current.stamp)\n    .sort((left, right) => right.bounds.endStamp - left.bounds.endStamp)[0]\n  return previous?.entry || null\n}`
if (!attendance.includes(newFallback)) {
  assert.ok(attendance.includes(oldFallback), 'Fallback für den zuletzt geplanten Dienst wurde nicht gefunden.')
  attendance = attendance.replace(oldFallback, newFallback)
}

if (!attendance.includes('scheduleIsToday:')) {
  const employeeSchedule = `            schedule: schedulePayload(schedule),\n            clocking,`
  const employeeScheduleWithFlag = `            schedule: schedulePayload(schedule),\n            scheduleIsToday: Boolean(schedule && schedule.date === today),\n            clocking,`
  assert.ok(attendance.includes(employeeSchedule), 'Mitarbeiter-Antwort für Dienstplanstatus wurde nicht gefunden.')
  attendance = attendance.replace(employeeSchedule, employeeScheduleWithFlag)

  const managementSchedule = `          schedule: schedulePayload(schedule),\n          schedules: candidates.map((entry) => schedulePayload(entry)),`
  const managementScheduleWithFlag = `          schedule: schedulePayload(schedule),\n          scheduleIsToday: Boolean(schedule && schedule.date === today),\n          schedules: candidates.map((entry) => schedulePayload(entry)),`
  assert.ok(attendance.includes(managementSchedule), 'Management-Antwort für Dienstplanstatus wurde nicht gefunden.')
  attendance = attendance.replace(managementSchedule, managementScheduleWithFlag)
}

await writeFile(attendancePath, attendance)

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
const oldDisplay = `          <span>Heutiger Dienst</span>\n          <strong>{state.schedule ? \`${'${state.schedule.start || \'–\'}'}–${'${state.schedule.end || \'–\'}'}\` : 'Kein Dienst veröffentlicht'}</strong>\n          <p>{state.schedule ? \`${'${state.schedule.location || \'–\'}'} · ${'${state.schedule.workArea || \'–\'}'}\` : 'Der Dienstplan wurde für heute noch nicht freigegeben.'}</p>`
const newDisplay = `          <span>{state.schedule && state.scheduleIsToday === false ? 'Letzter Dienst' : 'Heutiger Dienst'}</span>\n          <strong>{state.schedule ? \`${'${state.schedule.start || \'–\'}'}–${'${state.schedule.end || \'–\'}'}\` : 'Heute kein Dienst'}</strong>\n          <p>{state.schedule ? \`${'${state.scheduleIsToday === false && state.schedule.date ? `${formatDate(state.schedule.date)} · ` : \'\'}'}${'${state.schedule.location || \'–\'}'} · ${'${state.schedule.workArea || \'–\'}'}\` : 'Für dich ist heute kein Dienst eingetragen.'}</p>`
if (!app.includes(newDisplay)) {
  assert.ok(app.includes(oldDisplay), 'Anzeige für den heutigen Dienst wurde nicht gefunden.')
  app = app.replace(oldDisplay, newDisplay)
}
await writeFile(appPath, app)

console.log('Attendance previous-shift display applied')
