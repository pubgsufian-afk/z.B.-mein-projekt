const OIDC_AUDIENCE = 'habun-schedule-assistant'
const ENVELOPE_PATH = 'ops/schedule-command.envelope.json'
const EXPECTED_REPOSITORY = 'pubgsufian-afk/z.B.-mein-projekt'
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

async function loadEnvelope() {
  const ref = requiredEnv('SCHEDULE_ENVELOPE_REF')
  if (!/^[0-9a-f]{40}$/i.test(ref)) throw new Error('Ungültige Dienstplan-Envelope-Revision')
  const repository = requiredEnv('GITHUB_REPOSITORY_NAME')
  if (repository !== EXPECTED_REPOSITORY) throw new Error('Ungültiges Dienstplan-Repository')
  const relayToken = requiredEnv('GITHUB_RELAY_TOKEN')

  const response = await fetch(`https://api.github.com/repos/${repository}/contents/${ENVELOPE_PATH}?ref=${encodeURIComponent(ref)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${relayToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub Dienstplan-Envelope konnte nicht geladen werden (${response.status})`)
  const payload = await response.json()
  const encoded = String(payload?.content || '').replace(/\s+/g, '')
  if (!encoded) throw new Error('GitHub Dienstplan-Envelope ist leer')
  const envelope = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('GitHub Dienstplan-Envelope ist ungültig')
  }
  return envelope
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

const envelope = await loadEnvelope()
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
const directoryDiagnostics = result?.directoryDiagnostics && typeof result.directoryDiagnostics === 'object'
  ? result.directoryDiagnostics
  : {}
const identityUserCount = count(directoryDiagnostics.identityUserCount ?? 0)
const accessCount = count(directoryDiagnostics.accessCount ?? 0)
const registrationCount = count(directoryDiagnostics.registrationCount ?? 0)
const combinedAccessCount = count(directoryDiagnostics.combinedAccessCount ?? 0)
const requestedCount = count(directoryDiagnostics.requestedCount ?? 0)
const identityLookupSucceeded = directoryDiagnostics.identityLookupSucceeded === true

console.log(`Habun schedule OIDC relay: employees=${employeeCount} published=${publishedCount} duplicate=${duplicateCount} rejected=${rejectedCount}`)
console.log(`Habun schedule OIDC relay: directory identity=${identityUserCount} access=${accessCount} registrations=${registrationCount} combined=${combinedAccessCount} employees=${employeeCount} requested=${requestedCount} identityOk=${identityLookupSucceeded}`)
if (rejectedCount > 0) process.exitCode = 2
