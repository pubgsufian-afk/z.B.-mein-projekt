import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')
let changed = false

const authMarker = `  const expectedToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''\n  if (!secureTokenMatches(bearerToken(request), expectedToken)) {`
const authReplacement = `  const receivedToken = bearerToken(request)\n  const expectedToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''\n  const bridgeToken = Netlify.env.get('SCHEDULE_ASSISTANT_BRIDGE_TOKEN') || ''\n  if (!secureTokenMatches(receivedToken, expectedToken) && !secureTokenMatches(receivedToken, bridgeToken)) {`

if (!source.includes(authReplacement)) {
  if (!source.includes(authMarker)) throw new Error('Schedule bridge auth patch marker fehlt in schedule-assistant.mts')
  source = source.replace(authMarker, authReplacement)
  changed = true
}

const marker = `    const action = text(body.action)\n\n    if (action === 'resolve-employees') {`
const replacement = `    const action = text(body.action)\n\n    if (action === 'sync-directory') {\n      await writeScheduleAudit({\n        actorId: 'dienstplan-assistent',\n        actorType: 'chatgpt',\n        action: 'directory-synced',\n        details: { employeeCount: employees.length },\n      })\n      return json({\n        integration: 'Dienstplan-Assistent',\n        role: 'scheduler',\n        employeeCount: employees.length,\n      })\n    }\n\n    if (action === 'resolve-employees') {`

if (!source.includes(replacement)) {
  if (!source.includes(marker)) throw new Error('Schedule worker patch marker fehlt in schedule-assistant.mts')
  source = source.replace(marker, replacement)
  changed = true
}

if (changed) {
  await writeFile(path, source)
  console.log('Schedule command access patches applied')
} else {
  console.log('Schedule command access patches already applied')
}
