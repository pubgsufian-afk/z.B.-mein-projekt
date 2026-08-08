import type { Config, Context } from '@netlify/functions'
import { createHash } from 'node:crypto'
import { verifyScheduleGithubOidc } from './_shared/schedule-github-oidc.mts'
import { decryptScheduleCommandEnvelopeRuntime } from './_shared/schedule-command-envelope-runtime.mts'
import { parseScheduleCommand } from './_shared/schedule-command-worker-core.mts'
import scheduleAssistant from './schedule-assistant.mts'

type AssistantEntry = {
  index?: unknown
  status?: unknown
}

type AssistantResponse = {
  employeeCount?: unknown
  directoryDiagnostics?: unknown
  results?: unknown
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

  const requestBody = parsed.command.action === 'publish-shifts'
    ? {
        action: 'publish-shifts',
        requestId: parsed.command.commandId,
        shifts: Array.isArray(parsed.command.shifts) ? parsed.command.shifts.slice(0, 100) : [],
      }
    : {
        action: 'sync-directory',
        requestId: parsed.command.commandId,
      }

  const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  }), context)

  const data = await response.json().catch(() => ({})) as AssistantResponse
  if (!response.ok) return json({ message: 'Dienstplan-Auftrag konnte nicht verarbeitet werden.' }, response.status)

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

  return json({
    commandHash,
    action: parsed.command.action,
    employeeCount: number(data.employeeCount || directoryDiagnostics.employeeCount),
    directoryDiagnostics,
    publishedCount,
    duplicateCount,
    rejectedCount,
    results: results.map((entry, index) => ({
      index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : index,
      status: safeStatus(entry?.status),
    })),
  })
}

export const config: Config = {
  path: '/api/schedule-oidc-trigger',
}
