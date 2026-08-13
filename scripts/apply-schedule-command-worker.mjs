import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')
let changed = false

const baseAuth = `  const expectedToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''\n  if (!secureTokenMatches(bearerToken(request), expectedToken)) {`
if (!source.includes(baseAuth)) throw new Error('Schedule assistant token auth marker fehlt')

if (!source.includes('directoryDiagnostics')) {
  throw new Error('Schedule directory diagnostics fehlen vor dem Worker-Patch')
}

const marker = `    const action = text(body.action)\n\n    if (action === 'resolve-employees') {`
const replacement = `    const action = text(body.action)\n\n    if (action === 'sync-directory') {\n      await writeScheduleAudit({\n        actorId: 'dienstplan-assistent',\n        actorType: 'chatgpt',\n        action: 'directory-synced',\n        details: { employeeCount: employees.length },\n      })\n      return json({\n        integration: 'Dienstplan-Assistent',\n        role: 'scheduler',\n        employeeCount: employees.length,\n        directoryDiagnostics,\n      })\n    }\n\n    if (action === 'resolve-employees') {`

const fullControlAlreadyApplied = source.includes("if (action === 'sync-directory')")
if (!source.includes(replacement) && !fullControlAlreadyApplied) {
  if (!source.includes(marker)) throw new Error('Schedule worker patch marker fehlt in schedule-assistant.mts')
  source = source.replace(marker, replacement)
  changed = true
}

if (changed) {
  await writeFile(path, source)
  console.log('Schedule command worker patch applied')
} else {
  console.log('Schedule command worker patch already applied')
}

await import('./restore-timesheet-performance-input.mjs')
await import('./ensure-settings-performance-input.mjs')
