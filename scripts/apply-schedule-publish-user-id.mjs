import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('requestedEmployeeUserId')) {
  const oldBlock = `  const resolved = resolveAssistantEmployee(input.employeeName, employees)\n  if (resolved.status === 'ambiguous') {\n    return {\n      index,\n      employeeName: text(input.employeeName),\n      status: 'ambiguous',\n      candidates: resolved.candidates.map((candidate) => candidate.fullName),\n    }\n  }\n\n  let employee: { userId: string; fullName: string }\n  if (resolved.status === 'matched' && resolved.employee) {\n    employee = resolved.employee\n  } else if (allowUnregistered && resolved.status === 'not_found') {\n    const fullName = text(input.employeeName)\n    const userId = provisionalEmployeeUserId(fullName)\n    if (!userId) {\n      return { index, employeeName: fullName, status: 'invalid', message: 'Mitarbeitername fehlt.' }\n    }\n    employee = { userId, fullName }\n  } else {\n    return { index, employeeName: text(input.employeeName), status: 'not_found' }\n  }`

  assert.ok(source.includes(oldBlock), 'Schedule publish employee resolution anchor missing')

  const newBlock = `  const requestedEmployeeUserId = text((input as unknown as Record<string, unknown>).employeeUserId)\n  let employee: { userId: string; fullName: string }\n\n  if (requestedEmployeeUserId) {\n    const candidate = employees.find((candidate) => candidate.userId === requestedEmployeeUserId)\n    if (!candidate) {\n      return {\n        index,\n        employeeName: text(input.employeeName),\n        status: 'not_found',\n        message: 'Mitarbeiter-ID wurde nicht gefunden.',\n      }\n    }\n    if (text(input.employeeName).toLocaleLowerCase('de') !== candidate.fullName.trim().toLocaleLowerCase('de')) {\n      return {\n        index,\n        employeeName: text(input.employeeName),\n        status: 'invalid',\n        message: 'Mitarbeiter-ID und Mitarbeitername passen nicht zusammen.',\n      }\n    }\n    employee = candidate\n  } else {\n    const resolved = resolveAssistantEmployee(input.employeeName, employees)\n    if (resolved.status === 'ambiguous') {\n      return {\n        index,\n        employeeName: text(input.employeeName),\n        status: 'ambiguous',\n        candidates: resolved.candidates.map((candidate) => candidate.fullName),\n      }\n    }\n\n    if (resolved.status === 'matched' && resolved.employee) {\n      employee = resolved.employee\n    } else if (allowUnregistered && resolved.status === 'not_found') {\n      const fullName = text(input.employeeName)\n      const userId = provisionalEmployeeUserId(fullName)\n      if (!userId) {\n        return { index, employeeName: fullName, status: 'invalid', message: 'Mitarbeitername fehlt.' }\n      }\n      employee = { userId, fullName }\n    } else {\n      return { index, employeeName: text(input.employeeName), status: 'not_found' }\n    }\n  }`

  source = source.replace(oldBlock, newBlock)
}

assert.match(source, /requestedEmployeeUserId/)
assert.match(source, /candidate\.userId === requestedEmployeeUserId/)
assert.match(source, /Mitarbeiter-ID und Mitarbeitername passen nicht zusammen\./)

await writeFile(path, source)
console.log('Schedule publish employee-id patch applied')
