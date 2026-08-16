import type { Config, Context } from '@netlify/functions'
import { createCipheriv, createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import { verifyScheduleGithubOidc } from './_shared/schedule-github-oidc.mts'
import { decryptScheduleCommandEnvelopeRuntime } from './_shared/schedule-command-envelope-runtime.mts'
import { parseScheduleCommand, type ScheduleWorkerCommand } from './_shared/schedule-command-worker-core.mts'
import { findScheduleShift } from './_shared/schedule-neon-repository.mts'
import { syncPublishedScheduleShift } from './_shared/timesheet-schedule-sync.mts'
import scheduleAssistant from './schedule-assistant.mts'
import attendanceAssistant from './attendance-assistant.mts'

type AssistantEntry = {
  index?: unknown
  status?: unknown
  shiftId?: unknown
}

type AssistantResponse = {
  employeeCount?: unknown
  directoryDiagnostics?: unknown
  results?: unknown
  [key: string]: unknown
}

const ATTENDANCE_ACTIONS = new Set<ScheduleWorkerCommand['action']>([
  'list-attendance',
  'find-attendance-duplicates',
  'update-attendance-session',
  'delete-attendance-events',
])

function isAttendanceAction(action: ScheduleWorkerCommand['action']) {
  return ATTENDANCE_ACTIONS.has(action)
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0
}

function safeStatus(value: unknown) {
  const status = String(value ?? '').trim()
  return status || 'rejected'
}

function safeDirectoryDiagnostics(value: unknown) {
  const diagnostics = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    identityUserCount: number(diagnostics.identityUserCount),
    accessCount: number(diagnostics.accessCount),
    registrationCount: number(diagnostics.registrationCount),
    combinedAccessCount: number(diagnostics.combinedAccessCount),
    employeeCount: number(diagnostics.employeeCount),
    requestedCount: number(diagnostics.requestedCount),
    identityLookupSucceeded: diagnostics.identityLookupSucceeded === true,
  }
}

function assistantRequestBody(command: ScheduleWorkerCommand) {
  const body: Record<string, unknown> = {
    action: command.action,
    requestId: command.commandId,
  }
  if (command.action === 'publish-shifts') {
    body.shifts = command.shifts
    body.allowUnregistered = command.allowUnregistered === true
  }
  if (command.action === 'list-shifts' || command.action === 'find-duplicates') {
    body.from = command.from
    body.to = command.to
    if (command.employeeName) body.employeeName = command.employeeName
    if (command.employeeUserId) body.employeeUserId = command.employeeUserId
    if (command.location) body.location = command.location
    if (command.status) body.status = command.status
  }
  if (command.action === 'get-shift' || command.action === 'update-shift' || command.action === 'delete-shift') {
    body.shiftId = command.shiftId
  }
  if (command.action === 'update-shift') body.changes = command.changes
  if (command.action === 'list-attendance' || command.action === 'find-attendance-duplicates') {
    body.from = command.from
    body.to = command.to
  }
  if (command.action === 'update-attendance-session') {
    body.clockInEventId = command.clockInEventId
    body.clockOutEventId = command.clockOutEventId
    body.clockInAt = command.clockInAt
    body.clockOutAt = command.clockOutAt
    body.pauseMinutes = command.pauseMinutes
    body.reason = command.reason
  }
  if (command.action === 'delete-attendance-events') {
    body.eventIds = command.eventIds
    body.reason = command.reason
  }
  return body
}

function encryptAssistantResult(data: AssistantResponse, encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('Ungültiger Antwortschlüssel')
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8')
  if (plaintext.length > 400_000) throw new Error('Assistant-Antwort ist zu groß')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    version: 1,
    algorithm: 'A256GCM',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
}

function publicKeyRequest(envelope: unknown) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null
  const value = envelope as Record<string, unknown>
  if (value.version !== 1 || value.state !== 'public-key-request') return null
  return String(value.responseKey || '').trim()
}

function deriveRuntimePublicKey(privateKeyDerB64: string) {
  const privateKeyDer = Buffer.from(privateKeyDerB64, 'base64')
  const privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' })
  return createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString()
}

async function syncPublishedRelayResults(data: AssistantResponse) {
  const results = Array.isArray(data.results) ? data.results as AssistantEntry[] : []
  const synced: Array<{ index: number; action: string }> = []
  for (let fallbackIndex = 0; fallbackIndex < results.length; fallbackIndex += 1) {
    const entry = results[fallbackIndex]
    const status = safeStatus(entry?.status)
    if (!['published', 'duplicate'].includes(status)) continue
    const shiftId = String(entry?.shiftId ?? '').trim()
    if (!shiftId) continue
    const shift = await findScheduleShift(shiftId)
    if (!shift) continue
    const result = await syncPublishedScheduleShift(shift, 'dienstplan-assistent', new Date())
    synced.push({
      index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : fallbackIndex,
      action: result.action,
    })
  }
  return synced
}

export default async function scheduleOidcTrigger(request: Request, context: Context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

  try {
    await verifyScheduleGithubOidc(String(body.oidcToken || ''))
  } catch {
    return json({ message: 'Nicht autorisiert.' }, 401)
  }

  const privateKeyDerB64 = String(Netlify.env.get('SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64') || '').trim()
  if (!privateKeyDerB64) return json({ message: 'Dienstplan-Verbindung ist nicht konfiguriert.' }, 500)

  const keyRequestResponseKey = publicKeyRequest(body.envelope)
  if (keyRequestResponseKey) {
    try {
      const encryptedResult = encryptAssistantResult({
        publicKey: deriveRuntimePublicKey(privateKeyDerB64),
      }, keyRequestResponseKey)
      return json({
        employeeCount: 0,
        publishedCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
        results: [],
        encryptedResult,
      })
    } catch {
      return json({ message: 'Öffentlicher Relay-Schlüssel konnte nicht bereitgestellt werden.' }, 500)
    }
  }

  let command: Record<string, unknown>
  try {
    const privateKeyDer = Buffer.from(privateKeyDerB64, 'base64')
    command = decryptScheduleCommandEnvelopeRuntime(body.envelope, privateKeyDer)
  } catch {
    return json({ message: 'Verschlüsselter Dienstplan-Auftrag ist ungültig.' }, 400)
  }

  const parsed = parseScheduleCommand(JSON.stringify(command), new Date())
  if (!parsed.ok) return json({ message: parsed.message }, 400)

  const assistantToken = String(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || '').trim()
  if (!assistantToken) return json({ message: 'Dienstplan-Verbindung ist nicht konfiguriert.' }, 500)

  const requestBody = assistantRequestBody(parsed.command)
  const attendanceAction = isAttendanceAction(parsed.command.action)
  const assistant = attendanceAction ? attendanceAssistant : scheduleAssistant
  const assistantPath = attendanceAction ? '/api/attendance-assistant' : '/api/schedule-assistant'
  const response = await assistant(new Request(`https://internal.invalid${assistantPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  }), context)

  const data = await response.json().catch(() => ({})) as AssistantResponse
  if (!response.ok) {
    return json({ message: attendanceAction ? 'Zeiterfassungs-Auftrag konnte nicht verarbeitet werden.' : 'Dienstplan-Auftrag konnte nicht verarbeitet werden.' }, response.status)
  }

  if (parsed.command.action === 'publish-shifts') {
    data.timesheetSync = await syncPublishedRelayResults(data)
  }

  const results = Array.isArray(data.results) ? data.results as AssistantEntry[] : []
  const publicResults = results.map((entry, index) => ({
    index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : index,
    status: safeStatus(entry?.status),
  }))
  const publishedCount = publicResults.filter((entry) => entry.status === 'published').length
  const duplicateCount = publicResults.filter((entry) => entry.status === 'duplicate').length
  const rejectedCount = publicResults.filter((entry) => !['published', 'duplicate'].includes(entry.status)).length
  const directoryDiagnostics = safeDirectoryDiagnostics(data.directoryDiagnostics)
  const commandHash = createHash('sha256').update(parsed.command.commandId).digest('hex').slice(0, 12)

  let encryptedResult: ReturnType<typeof encryptAssistantResult> | undefined
  if (parsed.command.responseKey) {
    try {
      encryptedResult = encryptAssistantResult(data, parsed.command.responseKey)
    } catch {
      return json({ message: attendanceAction ? 'Verschlüsselte Zeiterfassungs-Antwort konnte nicht erzeugt werden.' : 'Verschlüsselte Dienstplan-Antwort konnte nicht erzeugt werden.' }, 500)
    }
  }

  return json({
    commandHash,
    action: parsed.command.action,
    employeeCount: number(data.employeeCount || directoryDiagnostics.employeeCount),
    directoryDiagnostics,
    publishedCount,
    duplicateCount,
    rejectedCount,
    results: publicResults,
    ...(encryptedResult ? { encryptedResult } : {}),
  })
}

export const config: Config = {
  path: '/api/schedule-oidc-trigger',
}
