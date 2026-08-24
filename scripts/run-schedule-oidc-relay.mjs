import { createDecipheriv } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const OIDC_AUDIENCE = 'habun-schedule-assistant'
const ENVELOPE_MARKER = '<!-- habun-schedule-envelope-v1 -->'
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

function envelopeFromComment(value) {
  const comment = String(value || '')
  if (!comment.startsWith(ENVELOPE_MARKER)) throw new Error('Ungültiger Dienstplan-Envelope-Marker')
  const raw = comment.slice(ENVELOPE_MARKER.length).trim()
  const envelope = JSON.parse(raw)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Ungültiger Dienstplan-Envelope')
  }
  return envelope
}

function safeEncryptedResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value
  if (result.version !== 1 || result.algorithm !== 'A256GCM') return null
  for (const field of ['iv', 'ciphertext', 'tag']) {
    if (!String(result[field] || '').trim()) return null
  }
  return {
    version: 1,
    algorithm: 'A256GCM',
    iv: String(result.iv),
    ciphertext: String(result.ciphertext),
    tag: String(result.tag),
  }
}

function safeRelayError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { message: '' }
  const message = String(value.message || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return { message }
}

function publicKeyFromEncryptedResult(envelope, encryptedResult) {
  if (envelope?.state !== 'public-key-request' || !encryptedResult) return null
  const responseKey = String(envelope.responseKey || '').trim()
  const key = Buffer.from(responseKey, 'base64')
  if (key.length !== 32) throw new Error('Ungültiger öffentlicher Antwortschlüssel')

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedResult.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(encryptedResult.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedResult.ciphertext, 'base64')),
    decipher.final(),
  ])
  const payload = JSON.parse(plaintext.toString('utf8'))
  const publicKey = String(payload?.publicKey || '').trim()
  if (!/^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----$/.test(publicKey)) {
    throw new Error('Öffentlicher Relay-Schlüssel ist ungültig')
  }
  return `${publicKey}\n`
}

const envelope = envelopeFromComment(requiredEnv('SCHEDULE_ENVELOPE_COMMENT'))
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

const relayResponse = await fetch(TRIGGER_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({ oidcToken, envelope }),
  signal: AbortSignal.timeout(25_000),
})
if (!relayResponse.ok) {
  const relayError = safeRelayError(await relayResponse.json().catch(() => null))
  const detail = relayError.message ? `: ${relayError.message}` : ''
  throw new Error(`Habun schedule relay failed (${relayResponse.status})${detail}`)
}

const result = await relayResponse.json()
const employeeCount = count(result?.employeeCount ?? 0)
const publishedCount = count(result?.publishedCount ?? 0)
const duplicateCount = count(result?.duplicateCount ?? 0)
const rejectedCount = count(result?.rejectedCount ?? 0)
const hasPortalAdminCounts = result?.succeededCount !== undefined
const succeededCount = hasPortalAdminCounts ? count(result?.succeededCount ?? 0) : 0
const directoryDiagnostics = result?.directoryDiagnostics && typeof result.directoryDiagnostics === 'object'
  ? result.directoryDiagnostics
  : {}
const identityUserCount = count(directoryDiagnostics.identityUserCount ?? 0)
const accessCount = count(directoryDiagnostics.accessCount ?? 0)
const registrationCount = count(directoryDiagnostics.registrationCount ?? 0)
const combinedAccessCount = count(directoryDiagnostics.combinedAccessCount ?? 0)
const requestedCount = count(directoryDiagnostics.requestedCount ?? 0)
const identityLookupSucceeded = directoryDiagnostics.identityLookupSucceeded === true
const encryptedResult = safeEncryptedResult(result?.encryptedResult)

console.log(`Habun schedule OIDC relay: employees=${employeeCount} published=${publishedCount} duplicate=${duplicateCount} rejected=${rejectedCount}`)
console.log(`Habun schedule OIDC relay: directory identity=${identityUserCount} access=${accessCount} registrations=${registrationCount} combined=${combinedAccessCount} employees=${employeeCount} requested=${requestedCount} identityOk=${identityLookupSucceeded}`)
if (hasPortalAdminCounts) {
  console.log(`Habun portal admin OIDC relay: succeeded=${succeededCount} rejected=${rejectedCount}`)
}

if (encryptedResult) {
  const resultPath = requiredEnv('SCHEDULE_ENCRYPTED_RESULT_PATH')
  await writeFile(resultPath, JSON.stringify(encryptedResult), { encoding: 'utf8', mode: 0o600 })
  console.log('Habun schedule OIDC relay: encrypted result artifact prepared')

  const publicKey = publicKeyFromEncryptedResult(envelope, encryptedResult)
  if (publicKey) {
    const publicKeyPath = requiredEnv('SCHEDULE_PUBLIC_KEY_RESULT_PATH')
    await writeFile(publicKeyPath, publicKey, { encoding: 'utf8', mode: 0o600 })
    console.log('Habun schedule OIDC relay: public key response prepared')
  }
}
if (rejectedCount > 0) process.exitCode = 2
