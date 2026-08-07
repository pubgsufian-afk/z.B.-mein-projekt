import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8')
  let changed = false
  for (const { from, to } of replacements) {
    if (source.includes(to)) continue
    if (!source.includes(from)) throw new Error(`Null-coordinate patch marker fehlt in ${path}: ${from.slice(0, 120)}`)
    source = source.replace(from, to)
    changed = true
  }
  if (changed) await writeFile(path, source)
  return changed
}

const changed = []

if (await patch('netlify/functions/_shared/attendance-service.mts', [
  {
    from: `      const configured = Boolean(object && Number.isFinite(Number(object.latitude)) && Number.isFinite(Number(object.longitude)))`,
    to: `      const hasLatitude = object?.latitude !== null && object?.latitude !== undefined && object?.latitude !== ''
      const hasLongitude = object?.longitude !== null && object?.longitude !== undefined && object?.longitude !== ''
      const configured = Boolean(
        object && hasLatitude && hasLongitude &&
        Number.isFinite(Number(object.latitude)) && Number.isFinite(Number(object.longitude)),
      )`,
  },
])) changed.push('attendance-service.mts')

if (await patch('netlify/functions/attendance.mts', [
  {
    from: `        const databaseConfigured = Boolean(
          fromDatabase && Number.isFinite(Number(fromDatabase.latitude)) && Number.isFinite(Number(fromDatabase.longitude)),
        )`,
    to: `        const hasDatabaseLatitude = fromDatabase?.latitude !== null && fromDatabase?.latitude !== undefined && fromDatabase?.latitude !== ''
        const hasDatabaseLongitude = fromDatabase?.longitude !== null && fromDatabase?.longitude !== undefined && fromDatabase?.longitude !== ''
        const databaseConfigured = Boolean(
          fromDatabase && hasDatabaseLatitude && hasDatabaseLongitude &&
          Number.isFinite(Number(fromDatabase.latitude)) && Number.isFinite(Number(fromDatabase.longitude)),
        )`,
  },
])) changed.push('attendance.mts')

console.log(changed.length ? `Null worksite coordinate fix applied: ${changed.join(', ')}` : 'Null worksite coordinate fix already applied')
