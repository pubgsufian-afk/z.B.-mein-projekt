import { readFile } from 'node:fs/promises'

const OIDC_AUDIENCE = 'habun-schedule-assistant'
const ENVELOPE_PATH = 'ops/schedule-command.envelope.json'
const TRIGGER_URL = 'https://habun-mitarbeiterportal.netlify.app/api/schedule-oidc-trigger'

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} fehlt`)
  return value
}

function count(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Ungültige Relay-Antwort')
  return Math.trunc(parsed)
}

const requestUrl = new URL(requiredEnv('ACTIONS_ID_TOKEN_REQUEST_URL'))
requestUrl.searchParams.set('audience', OIDC_AUDIENCE)
const requestToken = requiredEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN')

const tokenResponse = await fetch(requestUrl, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${requestToken}`,
    Accept: 'application/json',
  },
  signal: AbortSignal.timeout(10_000),
})
if (!tokenResponse.ok) throw new Error(`GitHub OIDC token request failed (${tokenResponse.status})`)
const tokenPayload = await tokenResponse.json()
const oidcToken = String(tokenPayload?.value || '').trim()
if (!oidcToken) throw new Error('GitHub OIDC token response is empty')

const envelope = JSON.parse(await readFile(ENVELOPE_PATH, 'utf8'))
const relayResponse = await fetch(TRIGGER_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({ oidcToken, envelope }),
  signal: AbortSignal.timeout(25_000),
})
if (!relayResponse.ok) throw new Error(`Habun schedule relay failed (${relayResponse.status})`)

const result = await relayResponse.json()
const employeeCount = count(result?.employeeCount ?? 0)
const publishedCount = count(result?.publishedCount ?? 0)
const duplicateCount = count(result?.duplicateCount ?? 0)
const rejectedCount = count(result?.rejectedCount ?? 0)

console.log(`Habun schedule OIDC relay: employees=${employeeCount} published=${publishedCount} duplicate=${duplicateCount} rejected=${rejectedCount}`)
if (rejectedCount > 0) process.exitCode = 2
