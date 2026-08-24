import assert from 'node:assert/strict'
import { runEmployeeHistoryCorrectionFlow } from './portal-admin-history-flow.mjs'

const state = {
  schedule: [
    { id: 'before', userId: 'guest:kwame', date: '2026-07-31' },
    { id: 's1', userId: 'guest:kwame', date: '2026-08-01' },
    { id: 's2', userId: 'guest:kwame', date: '2026-08-24' },
    { id: 'after', userId: 'guest:kwame', date: '2026-08-25' },
    { id: 'other', userId: 'other-user', date: '2026-08-10' },
  ],
  timesheet: [
    { id: 't1', userId: 'guest:kwame', date: '2026-08-10' },
    { id: 't2', userId: 'guest:kwame', date: '2026-08-24' },
  ],
  attendance: [
    { id: 'a1', userId: 'guest:kwame', date: '2026-08-10' },
    { id: 'a2', userId: 'guest:kwame', date: '2026-08-24' },
    { id: 'a3', userId: 'guest:kwame', date: '2026-08-25' },
  ],
}

const calls = []
const inRange = (date, from, to) => date >= from && date <= to
const invoke = async (command) => {
  calls.push(command.action)
  const { from, to } = command.input
  if (command.action === 'inspect-employee-history') {
    const targetUserId = command.input.employeeUserId
    return {
      schedule: state.schedule.filter((row) => row.userId === targetUserId && inRange(row.date, from, to)),
      legacyTimesheet: state.timesheet.filter((row) => row.userId === targetUserId && inRange(row.date, from, to)),
      attendance: state.attendance.filter((row) => row.userId === targetUserId && inRange(row.date, from, to)),
    }
  }
  if (command.action === 'rebind-employee-history') {
    for (const collection of [state.schedule, state.timesheet, state.attendance]) {
      for (const row of collection) {
        if (row.userId === command.input.sourceUserId && inRange(row.date, from, to)) row.userId = command.input.targetUserId
      }
    }
    return { success: true }
  }
  throw new Error(`unexpected ${command.action}`)
}

const result = await runEmployeeHistoryCorrectionFlow(invoke, {
  sourceUserId: 'guest:kwame',
  targetUserId: 'registered-kwame',
  targetFullName: 'Kwame Akakpo',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
  reason: 'Registriertes Konto zuordnen',
})

assert.deepEqual(calls, [
  'inspect-employee-history',
  'rebind-employee-history',
  'inspect-employee-history',
])
assert.equal(result.before.schedule.length, 0)
assert.deepEqual(result.after.schedule.map((row) => row.id), ['s1', 's2'])
assert.deepEqual(result.after.legacyTimesheet.map((row) => row.id), ['t1', 't2'])
assert.deepEqual(result.after.attendance.map((row) => row.id), ['a1', 'a2'])
assert.equal(state.schedule.find((row) => row.id === 'before').userId, 'guest:kwame')
assert.equal(state.schedule.find((row) => row.id === 'after').userId, 'guest:kwame')
assert.equal(state.attendance.find((row) => row.id === 'a3').userId, 'guest:kwame')
assert.equal(state.schedule.find((row) => row.id === 'other').userId, 'other-user')

console.log('portal admin schedule attendance integration test passed')
