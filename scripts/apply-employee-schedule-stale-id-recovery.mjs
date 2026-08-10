import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const repositoryPath = 'netlify/functions/_shared/schedule-neon-repository.mts'
let repository = await readFile(repositoryPath, 'utf8')

if (!repository.includes('export async function listEmployeeScheduleShifts')) {
  const marker = `export async function findScheduleShift(id: string) {`
  assert.ok(repository.includes(marker), 'Einfügepunkt für Mitarbeiter-Dienstplanleser fehlt.')
  const helper = `export async function listEmployeeScheduleShifts(filters: {\n  from?: string\n  to?: string\n  employeeUserId: string\n  employeeName?: string\n  publishedOnly?: boolean\n}) {\n  const employeeUserId = String(filters.employeeUserId || '').trim()\n  const employeeName = String(filters.employeeName || '').trim()\n  const params: unknown[] = [employeeUserId, employeeName]\n  const clauses: string[] = [\`(\n    employee_user_id = $1\n    OR (\n      $2 <> ''\n      AND lower(btrim(employee_name)) = lower(btrim($2))\n      AND EXISTS (\n        SELECT 1\n          FROM schedule_employees current_employee\n         WHERE current_employee.user_id = $1\n           AND current_employee.status = 'active'\n           AND lower(btrim(current_employee.full_name)) = lower(btrim($2))\n      )\n      AND (\n        SELECT COUNT(*)\n          FROM schedule_employees same_name\n         WHERE same_name.status = 'active'\n           AND lower(btrim(same_name.full_name)) = lower(btrim($2))\n      ) = 1\n    )\n  )\`]\n  const add = (clause: string, value: unknown) => {\n    params.push(value)\n    clauses.push(clause.replace('?', \`$\${params.length}\`))\n  }\n  if (filters.from) add('shift_date >= ?::date', filters.from)\n  if (filters.to) add('shift_date <= ?::date', filters.to)\n  if (filters.publishedOnly) clauses.push(\"status = 'published'\")\n  const database = getDatabase()\n  const result = await database.pool.query(\n    \`SELECT * FROM schedule_shifts WHERE \${clauses.join(' AND ')} ORDER BY shift_date, start_time, employee_name, id\`,\n    params,\n  )\n  return result.rows.map((row) => mapScheduleShiftRow(row))\n}\n\n${marker}`
  repository = repository.replace(marker, helper)
  await writeFile(repositoryPath, repository)
}

const schedulePath = 'netlify/functions/schedule-v2-neon.mts'
let schedule = await readFile(schedulePath, 'utf8')

if (!schedule.includes('listEmployeeScheduleShifts,')) {
  const importMarker = `  listActiveScheduleEmployees,\n  listScheduleOverlaps,`
  assert.ok(schedule.includes(importMarker), 'Importmarker für Mitarbeiter-Dienstplanleser fehlt.')
  schedule = schedule.replace(importMarker, `  listActiveScheduleEmployees,\n  listEmployeeScheduleShifts,\n  listScheduleOverlaps,`)
}

if (!schedule.includes('return listEmployeeScheduleShifts({')) {
  const oldBlock = `  if (!SCHEDULING.has(String(current.role))) {\n    return listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })\n  }`
  assert.ok(schedule.includes(oldBlock), 'Alter Mitarbeiter-Dienstplanfilter wurde nicht gefunden.')
  const newBlock = `  if (!SCHEDULING.has(String(current.role))) {\n    const activeEmployees = await listActiveScheduleEmployees()\n    const activeEmployee = activeEmployees.find((employee) => String(employee.userId) === String(current.userId))\n    const identity = current.user as { name?: unknown; userMetadata?: Record<string, unknown> | null }\n    const employeeName = String(\n      activeEmployee?.fullName\n      || identity.name\n      || identity.userMetadata?.full_name\n      || identity.userMetadata?.fullName\n      || '',\n    ).trim()\n    return listEmployeeScheduleShifts({\n      from,\n      to,\n      employeeUserId: current.userId,\n      employeeName,\n      publishedOnly: true,\n    })\n  }`
  schedule = schedule.replace(oldBlock, newBlock)
}

await writeFile(schedulePath, schedule)
console.log('Employee schedule stale ID recovery applied')
