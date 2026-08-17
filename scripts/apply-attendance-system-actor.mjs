import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const servicePath = 'netlify/functions/_shared/attendance-service.mts'
let service = await readFile(servicePath, 'utf8')

if (!service.includes("['owner', 'admin', 'manager', 'employee', 'system'].includes(role)")) {
  const before = "['owner', 'admin', 'manager', 'employee'].includes(role)"
  assert.ok(service.includes(before), 'Attendance actor role list not found')
  service = service.replace(before, "['owner', 'admin', 'manager', 'employee', 'system'].includes(role)")
}

if (!service.includes('const actorId = String(actor?.actorId || userId).trim()')) {
  const before = `  const role = String(actor?.role || '').trim()\n  if (!userId || !email || !['owner', 'admin', 'manager', 'employee', 'system'].includes(role)) throw new AttendanceServiceError('Nicht angemeldet.', 401, 'UNAUTHENTICATED')\n  return { userId, email, role }`
  const after = `  const role = String(actor?.role || '').trim()\n  const actorId = String(actor?.actorId || userId).trim()\n  if (!userId || !email || !actorId || !['owner', 'admin', 'manager', 'employee', 'system'].includes(role)) throw new AttendanceServiceError('Nicht angemeldet.', 401, 'UNAUTHENTICATED')\n  return { userId, actorId, email, role }`
  assert.ok(service.includes(before), 'Attendance actor return block not found')
  service = service.replace(before, after)
}

if (!service.includes('actorId: current.actorId')) {
  const before = `        userId: current.userId,\n        actorEmail: current.email,`
  const after = `        userId: current.userId,\n        actorId: current.actorId,\n        actorEmail: current.email,`
  assert.ok(service.includes(before), 'Attendance commit actor block not found')
  service = service.replace(before, after)
}
await writeFile(servicePath, service)

const repoPath = 'netlify/functions/_shared/neon-attendance.mts'
let repo = await readFile(repoPath, 'utf8')
if (!repo.includes('record.actorId || record.userId')) {
  const before = `      JSON.stringify(responseData),\n      auditId,\n    ]`
  const after = `      JSON.stringify(responseData),\n      auditId,\n      record.actorId || record.userId,\n    ]`
  assert.ok(repo.includes(before), 'Attendance repository params end not found')
  repo = repo.replace(before, after)
}
if (!repo.includes('SELECT $21, $5::timestamptz, $22, $13, $14, $4,')) {
  const before = '         SELECT $21, $5::timestamptz, $1, $13, $14, $4,'
  const after = '         SELECT $21, $5::timestamptz, $22, $13, $14, $4,'
  assert.ok(repo.includes(before), 'Attendance audit actor SQL not found')
  repo = repo.replace(before, after)
}
await writeFile(repoPath, repo)
console.log('Attendance system actor support applied')
