const enabled = String(process.env.SCHEDULE_ASSISTANT_BUILD_BRIDGE_ENABLED || '').trim()
const context = String(process.env.CONTEXT || '').trim()
const branch = String(process.env.BRANCH || '').trim()

if (enabled !== '1' || context !== 'production' || branch !== 'main') {
  console.log('Schedule build bridge skipped outside enabled main production build')
  process.exit(0)
}

const raw = String(process.env.SCHEDULE_ASSISTANT_COMMAND || '').trim()
const bridgeToken = String(process.env.SCHEDULE_ASSISTANT_BRIDGE_TOKEN || '').trim()
if (!raw) {
  console.log('Schedule build bridge skipped without command')
  process.exit(0)
}
if (!bridgeToken) throw new Error('Schedule build bridge token fehlt')

let command
try {
  command = JSON.parse(raw)
} catch {
  throw new Error('Schedule build bridge command ist ungültig')
}

const commandId = String(command?.commandId || '').trim()
const createdAtMs = Date.parse(String(command?.createdAt || ''))
const ageMs = Date.now() - createdAtMs
const action = String(command?.action || '').trim()
if (command?.version !== 1 || !commandId || !Number.isFinite(createdAtMs)) {
  throw new Error('Schedule build bridge command contract ist ungültig')
}
if (ageMs < -5 * 60 * 1000 || ageMs > 30 * 60 * 1000) {
  console.log(`Schedule build bridge skipped expired command ${commandId}`)
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

console.log(`Schedule build bridge processed ${commandId}: employees=${employeeCount}, published=${publishedCount}, duplicate=${duplicateCount}, rejected=${rejectedCount}`)
