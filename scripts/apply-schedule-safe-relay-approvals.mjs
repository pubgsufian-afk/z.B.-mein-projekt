import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-oidc-trigger.mts'
let source = await readFile(path, 'utf8')

const anchor = "    body.allowUnregistered = command.allowUnregistered === true\n"
const forwarding = "    body.approvedUnregisteredNames = command.approvedUnregisteredNames || []\n"

if (!source.includes(forwarding)) {
  assert.ok(source.includes(anchor), 'Schedule OIDC approval forwarding anchor missing')
  source = source.replace(anchor, `${anchor}${forwarding}`)
}

assert.match(source, /body\.approvedUnregisteredNames = command\.approvedUnregisteredNames \|\| \[\]/)
await writeFile(path, source)
console.log('Schedule safe relay approvals applied')
