import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const schedulePath = 'netlify/functions/schedule-v2-neon.mts'
let schedule = await readFile(schedulePath, 'utf8')

if (!schedule.includes('const ownEntries = await listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })')) {
  const oldBlock = `  if (!SCHEDULING.has(String(current.role))) {\n    return listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })\n  }`
  assert.ok(schedule.includes(oldBlock), 'Alter Mitarbeiter-Dienstplanfilter wurde nicht gefunden.')
  const newBlock = `  if (!SCHEDULING.has(String(current.role))) {\n    const ownEntries = await listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })\n    const activeEmployees = await listActiveScheduleEmployees()\n    const currentEmployee = activeEmployees.find((employee) => String(employee.userId) === String(current.userId))\n    const currentName = String(currentEmployee?.fullName || '').trim().toLocaleLowerCase('de-DE')\n    if (!currentName) return ownEntries\n    const sameNameEmployees = activeEmployees.filter((employee) => String(employee.fullName || '').trim().toLocaleLowerCase('de-DE') === currentName)\n    if (sameNameEmployees.length !== 1) return ownEntries\n    const publishedEntries = await listScheduleShifts({ from, to, publishedOnly: true })\n    const sameNameEntries = publishedEntries.filter((entry) => String(entry.employeeName || '').trim().toLocaleLowerCase('de-DE') === currentName)\n    return [...new Map([...ownEntries, ...sameNameEntries].map((entry) => [entry.id, entry])).values()]\n  }`
  schedule = schedule.replace(oldBlock, newBlock)
}

assert.ok(!schedule.includes('listEmployeeScheduleShifts'), 'Der fehleranfällige Mitarbeiter-SQL-Leser darf nicht mehr verwendet werden.')
await writeFile(schedulePath, schedule)
console.log('Employee schedule stale ID recovery applied')
