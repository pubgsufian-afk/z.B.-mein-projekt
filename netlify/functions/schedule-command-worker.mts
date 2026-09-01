import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import scheduleAssistant from './schedule-assistant.mts'
import { parseScheduleCommand, type ScheduleWorkerCommand } from './_shared/schedule-command-worker-core.mts'
import { decryptScheduleCommandEnvelopeRuntime } from './_shared/schedule-command-envelope-runtime.mts'
import { envelopeFromRelayComment, selectScheduleRelayComment } from './_shared/schedule-comment-relay.mts'

type AssistantResult = {
  employeeCount?: unknown
  results?: unknown
  entries?: unknown
  duplicates?: unknown
  deleted?: unknown
  id?: unknown
  shift?: { id?: unknown } | null
}

type ShiftResult = {
  status?: unknown
}

const RELAY_COMMENTS_URL = 'https://api.github.com/repos/pubgsufian-afk/z.B.-mein-projekt/issues/73/comments'

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function assistantBodyFromCommand(command: ScheduleWorkerCommand) {
  const body: Record<string, unknown> = {
    action: command.action,
    requestId: command.commandId,
  }
  if (command.action === 'publish-shifts') {
    body.shifts = command.shifts
    body.allowUnregistered = command.allowUnregistered === true
    body.approvedUnregisteredNames = command.approvedUnregisteredNames || []
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
  return body
}

function summarize(commandId: string, action: string, data: AssistantResult) {
  const results = Array.isArray(data.results) ? data.results as ShiftResult[] : []
  const publishedCount = results.filter((entry) => entry?.status === 'published').length
  const duplicateCount = results.filter((entry) => entry?.status === 'duplicate').length
  const rejectedCount = results.filter((entry) => !['published', 'duplicate'].includes(String(entry?.status || ''))).length
  const entries = Array.isArray(data.entries) ? data.entries : []
  const duplicates = Array.isArray(data.duplicates) ? data.duplicates : []
  const shiftId = String(data.shift?.id || data.id || '').trim()
  return {
    commandId,
    action,
    processedAt: new Date().toISOString(),
    employeeCount: number(data.employeeCount),
    publishedCount,
    duplicateCount,
    rejectedCount,
    entryCount: entries.length,
    duplicateScanCount: duplicates.length,
    deleted: data.deleted === true,
    shiftId,
  }
}

async function commandFromEncryptedRelay(now = new Date()): Promise<ScheduleWorkerCommand | null> {
  const since = new Date(now.getTime() - 35 * 60 * 1000).toISOString()
  const url = new URL(RELAY_COMMENTS_URL)
  url.searchParams.set('since', since)
  url.searchParams.set('per_page', '100')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'habun-schedule-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    console.warn(`schedule-command-worker GitHub relay lookup failed ${response.status}`)
    return null
  }

  const comments = await response.json().catch(() => [])
  const comment = selectScheduleRelayComment(comments)
  if (!comment) return null

  const privateKeyDerB64 = Netlify.env.get('SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64') || ''
  if (!privateKeyDerB64.trim()) {
    console.error('schedule-command-worker missing SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64')
    return null
  }

  try {
    const envelope = envelopeFromRelayComment(comment.body)
    const payload = decryptScheduleCommandEnvelopeRuntime(envelope, Buffer.from(privateKeyDerB64, 'base64'))
    const parsed = parseScheduleCommand(JSON.stringify(payload), now)
    if (!parsed.ok) {
      console.warn('schedule-command-worker ignored invalid relay command:', parsed.message)
      return null
    }
    return parsed.command
  } catch (error) {
    console.warn('schedule-command-worker ignored unreadable encrypted relay command', error)
    return null
  }
}

async function loadCommand(): Promise<ScheduleWorkerCommand | null> {
  const raw = Netlify.env.get('SCHEDULE_ASSISTANT_COMMAND_RUNTIME') || ''
  if (raw.trim()) {
    const parsed = parseScheduleCommand(raw)
    if (parsed.ok) return parsed.command
    console.warn('schedule-command-worker ignored invalid runtime command:', parsed.message)
  }
  return commandFromEncryptedRelay()
}

export default async function scheduleCommandWorker(_request: Request, context: Context) {
  const command = await loadCommand()
  if (!command) return

  const processedKey = `processed/${command.commandId}`
  let store: ReturnType<typeof getStore> | null = null
  try {
    store = getStore({ name: 'schedule-command-worker', consistency: 'strong' })
    const existing = await store.get(processedKey, { type: 'json' })
    if (existing) {
      console.log(`schedule-command-worker already processed ${command.commandId}`)
      return
    }
  } catch (error) {
    console.warn('schedule-command-worker state store unavailable; continuing with schedule duplicate protection', error)
    store = null
  }

  const token = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''
  if (!token) {
    console.error('schedule-command-worker missing SCHEDULE_ASSISTANT_TOKEN')
    return
  }

  const body = assistantBodyFromCommand(command)
  const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }), context)

  const data = await response.json().catch(() => ({})) as AssistantResult
  if (!response.ok) {
    console.error(`schedule-command-worker assistant failed ${response.status}`)
    return
  }

  const result = summarize(command.commandId, command.action, data)
  if (store) {
    try {
      await store.setJSON(processedKey, result)
    } catch (error) {
      console.warn('schedule-command-worker could not persist processed marker; duplicate protection remains active in schedule service', error)
    }
  }
  console.log(
    `schedule-command-worker processed ${command.commandId} action=${command.action} published=${result.publishedCount} duplicate=${result.duplicateCount} rejected=${result.rejectedCount} entries=${result.entryCount}`,
  )
}