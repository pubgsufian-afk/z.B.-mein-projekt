import { readFile, writeFile } from 'node:fs/promises'

let normalized = false
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
