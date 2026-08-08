import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/attendance.mts'
let source = await readFile(path, 'utf8')

const finalFallback = `  const today = plannedSchedules(entries, userId, date)\n  if (today.length) return today.at(-1) || null\n  const previous = bounded\n    .filter((item) => item.bounds.endStamp < current.stamp)\n    .sort((left, right) => right.bounds.startStamp - left.bounds.startStamp)[0]\n  return previous?.entry || null\n}`
const overnightIntermediate = `  const today = plannedSchedules(entries, userId, date)\n  return today.at(-1) || null\n}`

if (source.includes(finalFallback)) {
  source = source.replace(finalFallback, overnightIntermediate)
  await writeFile(path, source)
  console.log('Attendance overnight patch input normalized')
} else {
  console.log('Attendance overnight patch input already ready')
}
