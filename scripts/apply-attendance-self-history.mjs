import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const servicePath = 'netlify/functions/_shared/attendance-service.mts'
let service = await readFile(servicePath, 'utf8')
const oldHistory = `    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')\n      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },`
const selfHistory = `    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      const historyUserId = current.role === 'employee' ? current.userId : normalizedText(filters.userId)\n      return { entries: await repository.listHistory({ userId: historyUserId, from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },`

if (!service.includes(selfHistory)) {
  assert.ok(service.includes(oldHistory), 'Attendance self-history service marker fehlt')
  service = service.replace(oldHistory, selfHistory)
  await writeFile(servicePath, service)
}

const handlerPath = 'netlify/functions/attendance.mts'
let handler = await readFile(handlerPath, 'utf8')
const employeeHistoryBlock = /\s*if \(actor\.role === 'employee'\) return response\(\{ message: 'Keine Berechtigung\.', code: 'FORBIDDEN' \}, 403\)\n/
if (employeeHistoryBlock.test(handler)) {
  handler = handler.replace(employeeHistoryBlock, '')
  await writeFile(handlerPath, handler)
}

console.log('Attendance employee self-history is active')
