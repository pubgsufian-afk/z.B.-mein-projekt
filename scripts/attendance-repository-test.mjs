import assert from 'node:assert/strict'
import {
  mapAttendanceEventRow,
  mapAttendanceObjectRow,
  normalizeAttendanceFilters,
  repositorySafetyMarkers,
} from '../netlify/functions/_shared/neon-attendance.mts'

assert.deepEqual(mapAttendanceObjectRow({
  id: 'site-1', latitude: '52.375', longitude: '9.732', accuracy_meters: '10', radius_meters: '500',
}), {
  id: 'site-1', latitude: 52.375, longitude: 9.732, accuracyMeters: 10, radiusMeters: 500,
})
assert.equal(mapAttendanceObjectRow(null), null)

assert.deepEqual(mapAttendanceEventRow({
  id: 'event-1', user_id: 'user-1', client_event_id: 'client-1', action: 'clock-in',
  server_occurred_at: '2026-08-06T08:00:05.000Z', client_occurred_at: '2026-08-06T08:00:00.000Z',
  event_date: '2026-08-06', schedule_id: 'shift-1', object_id: 'site-1', location_status: 'inside',
  offline_captured: false, latitude: '52.375', longitude: '9.732', accuracy_meters: '12', distance_meters: '0',
}), {
  id: 'event-1', userId: 'user-1', clientEventId: 'client-1', action: 'clock-in',
  serverOccurredAt: '2026-08-06T08:00:05.000Z', clientOccurredAt: '2026-08-06T08:00:00.000Z',
  eventDate: '2026-08-06', scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside',
  offlineCaptured: false,
  location: { latitude: 52.375, longitude: 9.732, accuracyMeters: 12, distanceMeters: 0 },
})

assert.deepEqual(normalizeAttendanceFilters({ from: '2026-08-01', to: '2026-08-31', status: 'outside' }), {
  from: '2026-08-01', to: '2026-08-31', date: null, userId: null, objectId: null, status: 'outside',
})
assert.throws(() => normalizeAttendanceFilters({ from: '06.08.2026' }), /ISO-Datum/)
assert.throws(() => normalizeAttendanceFilters({ status: 'green' }), /Standortstatus/)

const markers = repositorySafetyMarkers()
assert.equal(markers.advisoryLock, true)
assert.equal(markers.idempotency, true)
assert.equal(markers.auditTrail, true)
assert.equal(markers.locationExpiryMonths, 6)
assert.equal(markers.attendanceExpiryMonths, 24)

console.log('Attendance repository tests passed · 13 assertions')
