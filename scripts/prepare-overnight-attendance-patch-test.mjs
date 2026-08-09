import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptPath = fileURLToPath(new URL('./prepare-overnight-attendance-patch.mjs', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'habun-overnight-patch-'))
const attendanceDirectory = join(root, 'netlify', 'functions')
const sharedDirectory = join(attendanceDirectory, '_shared')

const finalFallback = `function selectPlannedSchedule() {
  const today = plannedSchedules(entries, userId, date)
  if (today.length) return today.at(-1) || null
  const previous = bounded
    .filter((item) => item.bounds.endStamp < current.stamp)
    .sort((left, right) => right.bounds.startStamp - left.bounds.startStamp)[0]
  return previous?.entry || null
}
`

try {
  await mkdir(sharedDirectory, { recursive: true })
  await writeFile(join(attendanceDirectory, 'attendance.mts'), finalFallback)
  await writeFile(join(sharedDirectory, 'daily-attendance-service.mts'), 'export const ready = true\n')

  const result = spawnSync(process.execPath, [scriptPath], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(
    await readFile(join(attendanceDirectory, 'attendance.mts'), 'utf8'),
    finalFallback,
    'Ein wiederholter Build darf die bereits korrekte Auswahl des letzten Dienstes nicht zurücksetzen.',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Overnight attendance patch idempotence test passed')
