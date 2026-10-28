import assert from 'node:assert/strict'
import { validateAssistantShiftInput, classifyAssistantDuplicate } from '../netlify/functions/_shared/schedule-assistant-core.mts'
globalThis.window = { addEventListener() {} }
const { netShiftMinutes } = await import('../public/schedule-v2.js')
const shift = { employeeUserId: 'employee', employeeName: 'Employee', date: '2026-10-16', start: '18:00', end: '00:00', workArea: 'Brandwache', location: 'Site', pauseMinutes: 0 }
assert.deepEqual(validateAssistantShiftInput(shift), { ok: true })
assert.equal(netShiftMinutes('18:00', '00:00', 0), 360)
assert.equal(netShiftMinutes('18:00', '00:00', 30), 330)
assert.equal(validateAssistantShiftInput({ ...shift, pauseMinutes: 360 }).ok, false)
assert.equal(validateAssistantShiftInput({ ...shift, start: '00:00' }).ok, false)
assert.equal(validateAssistantShiftInput({ ...shift, end: '24:00' }).ok, false)
assert.equal(validateAssistantShiftInput({ ...shift, end: '06:00' }).ok, false)
assert.throws(() => netShiftMinutes('00:00', '00:00', 0))
const late = { ...shift, id: 'late', start: '23:00', end: '23:30' }
assert.equal(classifyAssistantDuplicate(shift, [late]).overlaps[0]?.id, 'late')
assert.equal(classifyAssistantDuplicate(late, [shift]).overlaps.length, 1)
assert.equal(classifyAssistantDuplicate(shift, [{ ...late, start: '11:00', end: '18:00' }]).overlaps.length, 0)
console.log('Midnight end: six-hour duration, pause bounds, overlap and adjacency verified')

