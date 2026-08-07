import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  clockingWindowForSchedule,
  displayAttendancePhase,
  selectPlannedSchedule,
} from '../netlify/functions/attendance.mts'
import { createAttendanceService as createDailyAttendanceService } from '../netlify/functions/_shared/daily-attendance-service.mts'

const dayShift = {
  id: 'day-shift', employeeUserId: 'employee-1', employeeName: 'Mitarbeiter',
  date: '2026-08-07', start: '14:00', end: '22:00', location: 'Objekt', workArea: 'ZuKo',
  pauseMinutes: 0, objectId: 'site-1', status: 'published',
}
const afterDayShift = new Date('2026-08-07T20:15:00.000Z') // 22:15 Europe/Berlin
const insideDayShift = new Date('2026-08-07T19:30:00.000Z') // 21:30 Europe/Berlin
assert.equal(clockingWindowForSchedule(dayShift, afterDayShift).allowed, false)
assert.equal(displayAttendancePhase('working', dayShift, afterDayShift), 'working')
assert.equal(displayAttendancePhase('paused', dayShift, afterDayShift), 'paused')
assert.equal(displayAttendancePhase('completed', dayShift, afterDayShift), 'completed')
assert.equal(displayAttendancePhase('completed', dayShift, insideDayShift), 'idle')

const overnightShift = {
  ...dayShift,
  id: 'night-shift',
  date: '2026-08-07',
  start: '22:00',
  end: '06:00',
}
assert.equal(clockingWindowForSchedule(overnightShift, new Date('2026-08-07T19:30:00.000Z')).allowed, true) // 21:30, early window
assert.equal(clockingWindowForSchedule(overnightShift, new Date('2026-08-07T21:30:00.000Z')).allowed, true) // 23:30
assert.equal(clockingWindowForSchedule(overnightShift, new Date('2026-08-08T03:30:00.000Z')).allowed, true) // 05:30
assert.equal(clockingWindowForSchedule(overnightShift, new Date('2026-08-08T04:15:00.000Z')).allowed, false) // 06:15
assert.equal(
  selectPlannedSchedule([dayShift, overnightShift], 'employee-1', '2026-08-08', null, new Date('2026-08-08T02:00:00.000Z'))?.id,
  'night-shift',
)

const events = [{
  id: 'start-prev-day', userId: 'employee-1', clientEventId: 'start-prev-day', action: 'clock-in',
  clientOccurredAt: '2026-08-07T20:05:00.000Z', serverOccurredAt: '2026-08-07T20:05:00.000Z',
  eventDate: '2026-08-07', scheduleId: 'night-shift', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
}]
const repository = {
  async listEvents() { return events },
  async findIdempotency() { return null },
  async findObject() { return { id: 'site-1', latitude: 52.0, longitude: 9.0, radiusMeters: 100 } },
  async commitClockEvent(record) {
    events.push(record.event)
    return { kind: 'created', response: { event: record.event, location: record.location, replayed: false } }
  },
  async listHistory() { return events },
  async listLive() { return events },
}
const actor = { userId: 'employee-1', email: 'employee@example.com', role: 'employee' }
const now = () => new Date('2026-08-08T02:00:00.000Z')
const service = createDailyAttendanceService({ repository, now, randomUUID: () => 'finish-night' })
assert.equal((await service.getState(actor)).phase, 'working')
await service.record(actor, {
  action: 'clock-out',
  clientEventId: 'finish-night',
  clientOccurredAt: '2026-08-08T02:00:00.000Z',
  scheduleId: 'night-shift',
  objectId: 'site-1',
  location: null,
})
assert.equal((await service.getState(actor)).phase, 'completed')

const improvements = await readFile('public/improvements.js', 'utf8')
assert.match(improvements, /shiftDurationMinutes/)
assert.doesNotMatch(improvements, /Dienste über Mitternacht bitte als zwei Einträge erfassen/)

for (const path of ['netlify/functions/schedule-v2.mts', 'netlify/functions/schedule-v2-neon.mts']) {
  const source = await readFile(path, 'utf8')
  assert.match(source, /shiftDurationMinutes/)
  assert.doesNotMatch(source, /minutes\(String\(body\.end\)\) <= minutes\(String\(body\.start\)\)/)
}

const app = await readFile('frontend/src/App.jsx', 'utf8')
assert.match(app, /Arbeitsbeginn nicht verfügbar/)
assert.match(app, /Eine laufende Arbeitszeit kann weiterhin mit „Arbeit beenden“ abgeschlossen werden\./)

const repositorySource = await readFile('netlify/functions/_shared/schedule-neon-repository.mts', 'utf8')
assert.match(repositorySource, /CASE WHEN end_time < start_time THEN interval '1 day'/)

console.log('Overnight shift and attendance regression tests passed')
// This file intentionally participates in the production build verification.
