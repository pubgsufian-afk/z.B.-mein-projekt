import { readFile, writeFile } from 'node:fs/promises'

const attendancePath = 'netlify/functions/attendance.mts'
let attendance = await readFile(attendancePath, 'utf8')

const finalFallback = `  const today = plannedSchedules(entries, userId, date)\n  if (today.length) return today.at(-1) || null\n  const previous = bounded\n    .filter((item) => item.bounds.endStamp < current.stamp)\n    .sort((left, right) => right.bounds.startStamp - left.bounds.startStamp)[0]\n  return previous?.entry || null\n}`
const overnightIntermediate = `  const today = plannedSchedules(entries, userId, date)\n  return today.at(-1) || null\n}`

let normalized = false
if (attendance.includes(finalFallback)) {
  attendance = attendance.replace(finalFallback, overnightIntermediate)
  await writeFile(attendancePath, attendance)
  normalized = true
}

const dailyPath = 'netlify/functions/_shared/daily-attendance-service.mts'
let daily = await readFile(dailyPath, 'utf8')
const optimizedLoad = `      const rawEntries = await repository.listEvents(userId)\n      const entries = [...(Array.isArray(rawEntries) ? rawEntries : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))`
const overnightLoadIntermediate = `      const entries = [...(Array.isArray(await repository.listEvents(userId)) ? await repository.listEvents(userId) : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))`
if (daily.includes(optimizedLoad)) {
  daily = daily.replace(optimizedLoad, overnightLoadIntermediate)
  await writeFile(dailyPath, daily)
  normalized = true
}

console.log(normalized ? 'Attendance overnight patch inputs normalized' : 'Attendance overnight patch inputs already ready')
