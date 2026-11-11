import assert from 'node:assert/strict'
import { employeePublishedDaysOff, unassignedEmployeesByDate } from '../frontend/src/schedule-free-policy.mjs'

const days = ['2026-11-16', '2026-11-17', '2026-11-18']
const employees = [
  { userId: 'one', fullName: 'One', status: 'active' },
  { userId: 'two', fullName: 'Two', status: 'active' },
  { userId: 'inactive', fullName: 'Inactive', status: 'inactive' },
]
const entries = [{ employeeUserId: 'one', date: days[0], status: 'draft' }]
const daysOff = [{ employeeUserId: 'two', date: days[1], source: 'request' }]

assert.deepEqual(unassignedEmployeesByDate({ days, employees, entries, daysOff, show: false }), {},
  'Without an active draft or published week, no advance free days are shown')
const overview = unassignedEmployeesByDate({ days, employees, entries, daysOff, show: true })
assert.deepEqual(overview[days[0]].map((e) => e.userId), ['two'])
assert.deepEqual(overview[days[1]].map((e) => e.userId), ['one'])
assert.deepEqual(overview[days[2]].map((e) => e.userId), ['one', 'two'])

const unpublished = employeePublishedDaysOff({
  days, daysOff: [], weekPublished: false, visibleEntries: [], userId: 'one',
})
assert.deepEqual(unpublished, [], 'Unpublished future dates must not become free')

const free = employeePublishedDaysOff({
  days, daysOff: [], weekPublished: true,
  visibleEntries: [{ employeeUserId: 'one', date: days[0], status: 'published' }],
  userId: 'one',
})
assert.deepEqual(free.map((d) => d.date), [days[1], days[2]])
assert.ok(free.every((d) => d.source === 'automatic'))

const explicit = employeePublishedDaysOff({
  days, daysOff: [{ employeeUserId: 'one', date: days[1], source: 'request' }],
  weekPublished: true, visibleEntries: [{ date: days[0] }], userId: 'one',
})
assert.deepEqual(explicit.map((d) => [d.date, d.source]), [
  [days[1], 'request'],
  [days[2], 'automatic'],
], 'Approved requests are preserved and must not be duplicated')
assert.deepEqual(employeePublishedDaysOff({
  days, daysOff: [{ employeeUserId: 'two', date: days[1], source: 'manual' }],
  weekPublished: false, visibleEntries: [], userId: 'one',
}), [], 'Do not reveal other employees time off')

console.log('Schedule automatic-free policy: 7 assertions passed')
