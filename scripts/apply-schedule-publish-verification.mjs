import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('VERIFIED_SCHEDULE_PUBLISH_APPLIED')) {
  const publishAnchor = 'async function publishOne(\n'
  assert.ok(source.includes(publishAnchor), 'Verified publish function anchor missing')

  const helper = `function sameSchedulePublishState(expected: ScheduleShift, actual: ScheduleShift) {\n  return actual.employeeUserId === expected.employeeUserId\n    && actual.employeeName === expected.employeeName\n    && actual.date === expected.date\n    && actual.start === expected.start\n    && actual.end === expected.end\n    && actual.pauseMinutes === expected.pauseMinutes\n    && actual.objectId === expected.objectId\n    && actual.location === expected.location\n    && actual.workArea === expected.workArea\n    && actual.note === expected.note\n    && actual.status === expected.status\n    && actual.source === expected.source\n    && actual.sourceRef === expected.sourceRef\n}\n\n`
  source = source.replace(publishAnchor, `${helper}${publishAnchor}`)

  const candidateAnchor = `  const candidate: ScheduleShift = {`
  assert.ok(source.includes(candidateAnchor), 'Verified publish candidate anchor missing')
  source = source.replace(
    candidateAnchor,
    `  const sourceRef = \`assistant:\${requestId}:\${index}\`\n  const candidate: ScheduleShift = {`,
  )

  const sourceRefAnchor = `    sourceRef: \`assistant:\${requestId}:\${index}\`,`
  assert.ok(source.includes(sourceRefAnchor), 'Verified publish sourceRef anchor missing')
  source = source.replace(sourceRefAnchor, '    sourceRef,')

  const dateAnchor = `  const dateShifts = await listScheduleShifts({ from: candidate.date, to: candidate.date })\n  const classified = classifyAssistantDuplicate(candidate, dateShifts, employees)`
  assert.ok(source.includes(dateAnchor), 'Verified publish date-shifts anchor missing')
  source = source.replace(
    dateAnchor,
    `  const dateShifts = await listScheduleShifts({ from: candidate.date, to: candidate.date })\n  const existingSourceRef = dateShifts.find((entry) => entry.sourceRef === sourceRef)\n  if (existingSourceRef) {\n    if (sameSchedulePublishState(candidate, existingSourceRef)) {\n      return {\n        index,\n        employeeName: employee.fullName,\n        status: 'already_satisfied',\n        shiftId: existingSourceRef.id,\n        verified: true,\n      }\n    }\n    return {\n      index,\n      employeeName: employee.fullName,\n      status: 'request_conflict',\n      shiftId: existingSourceRef.id,\n      message: 'Dieser Dienstplan-Auftrag wurde bereits mit anderen Daten verarbeitet.',\n    }\n  }\n\n  const classified = classifyAssistantDuplicate(candidate, dateShifts, employees)`,
  )

  const duplicateAnchor = `  if (classified.exact) {\n    return { index, employeeName: employee.fullName, status: 'duplicate', shiftId: classified.exact.id }\n  }`
  assert.ok(source.includes(duplicateAnchor), 'Verified publish duplicate anchor missing')
  source = source.replace(
    duplicateAnchor,
    `  if (classified.exact) {\n    return { index, employeeName: employee.fullName, status: 'duplicate', shiftId: classified.exact.id, verified: true }\n  }`,
  )

  const upsertAnchor = `    const shift = await upsertScheduleShift(candidate)\n    await writeScheduleAudit({`
  assert.ok(source.includes(upsertAnchor), 'Verified publish upsert anchor missing')
  source = source.replace(
    upsertAnchor,
    `    const shift = await upsertScheduleShift(candidate)\n    const verified = await findScheduleShift(shift.id)\n    if (!verified || !sameSchedulePublishState(candidate, verified)) {\n      await writeScheduleAudit({\n        actorId: ACTOR_ID,\n        actorType: 'chatgpt',\n        action: 'shift-verification-failed',\n        shiftId: shift.id,\n        details: { requestId, sourceRef },\n      })\n      return {\n        index,\n        employeeName: employee.fullName,\n        status: 'verification_failed',\n        shiftId: shift.id,\n      }\n    }\n    await writeScheduleAudit({`,
  )

  const publishedReturnAnchor = `      status: 'published',\n      shiftId: shift.id,\n      warnings:`
  assert.ok(source.includes(publishedReturnAnchor), 'Verified publish result anchor missing')
  source = source.replace(
    publishedReturnAnchor,
    `      status: 'published',\n      shiftId: shift.id,\n      verified: true,\n      warnings:`,
  )

  source += '\n// VERIFIED_SCHEDULE_PUBLISH_APPLIED\n'
}

assert.match(source, /existingSourceRef/)
assert.match(source, /already_satisfied/)
assert.match(source, /verification_failed/)
assert.match(source, /const verified = await findScheduleShift\(shift\.id\)/)

await writeFile(path, source)
console.log('Schedule publish verification patch applied')
