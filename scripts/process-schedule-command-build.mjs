import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { decryptScheduleCommandEnvelope } from './schedule-command-envelope-crypto.mjs'

const envelopePath = 'ops/schedule-command.envelope.json'
const resultPath = 'dist/schedule-command-result.json'

let envelope
try {
  envelope = JSON.parse(await readFile(envelopePath, 'utf8'))
} catch {
  console.log('Schedule build bridge skipped without encrypted envelope')
  process.exit(0)
}

if (envelope?.state !== 'command') {
  console.log('Schedule build bridge skipped idle envelope')
  process.exit(0)
}

const privateKeyB64 = String(process.env.SCHEDULE_COMMAND_PRIVATE_KEY_B64 || '').trim()
const bridgeToken = String(process.env.SCHEDULE_ASSISTANT_BRIDGE_TOKEN || '').trim()
if (!privateKeyB64 || !bridgeToken) {
  console.log('Schedule build bridge skipped without production secrets')
  process.exit(0)
}

let command
try {
  const privateKeyPem = Buffer.from(privateKeyB64, 'base64').toString('utf8')
  command = decryptScheduleCommandEnvelope(envelope, privateKeyPem)
} catch {
  throw new Error('Schedule build bridge konnte den Auftrag nicht entschlüsseln')
}

const commandId = String(command?.commandId || '').trim()
const createdAtMs = Date.parse(String(command?.createdAt || ''))
const ageMs = Date.now() - createdAtMs
const action = String(command?.action || '').trim()
if (command?.version !== 1 || !commandId || !Number.isFinite(createdAtMs)) {
  throw new Error('Schedule build bridge command contract ist ungültig')
}
if (ageMs < -5 * 60 * 1000 || ageMs > 30 * 60 * 1000) {
  console.log('Schedule build bridge skipped expired encrypted command')
  process.exit(0)
}
if (!['sync-directory', 'publish-shifts'].includes(action)) {
  throw new Error('Schedule build bridge action ist ungültig')
}
if (action === 'publish-shifts' && (!Array.isArray(command.shifts) || command.shifts.length === 0)) {
  throw new Error('Schedule build bridge Dienstliste fehlt')
}

const requestBody = action === 'publish-shifts'
  ? { action, requestId: commandId, shifts: command.shifts.slice(0, 100) }
  : { action, requestId: commandId }

const response = await fetch('https://habun-mitarbeiterportal.netlify.app/api/schedule-assistant', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${bridgeToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(20_000),
})

if (!response.ok) throw new Error(`Schedule build bridge request fehlgeschlagen (${response.status})`)
const data = await response.json().catch(() => ({}))
const results = Array.isArray(data?.results) ? data.results : []
const publishedCount = results.filter((entry) => entry?.status === 'published').length
const duplicateCount = results.filter((entry) => entry?.status === 'duplicate').length
const rejectedCount = results.filter((entry) => !['published', 'duplicate'].includes(String(entry?.status || ''))).length
const employeeCount = Number.isFinite(Number(data?.employeeCount)) ? Number(data.employeeCount) : 0
const commandHash = createHash('sha256').update(commandId).digest('hex').slice(0, 12)

await writeFile(resultPath, `${JSON.stringify({
  state: 'processed',
  commandHash,
  employeeCount,
  publishedCount,
  duplicateCount,
  rejectedCount,
}, null, 2)}\n`)

console.log(`Schedule build bridge processed encrypted command: employees=${employeeCount}, published=${publishedCount}, duplicate=${duplicateCount}, rejected=${rejectedCount}`)
