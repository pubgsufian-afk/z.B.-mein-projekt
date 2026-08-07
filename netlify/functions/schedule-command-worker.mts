import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import scheduleAssistant from './schedule-assistant.mts'
import { parseScheduleCommand } from './_shared/schedule-command-worker-core.mts'

type AssistantResult = {
  employeeCount?: unknown
  results?: unknown
}

type ShiftResult = {
  status?: unknown
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function summarize(commandId: string, action: string, data: AssistantResult) {
  const results = Array.isArray(data.results) ? data.results as ShiftResult[] : []
  const publishedCount = results.filter((entry) => entry?.status === 'published').length
  const duplicateCount = results.filter((entry) => entry?.status === 'duplicate').length
  const rejectedCount = results.filter((entry) => !['published', 'duplicate'].includes(String(entry?.status || ''))).length
  return {
    commandId,
    action,
    processedAt: new Date().toISOString(),
    employeeCount: number(data.employeeCount),
    publishedCount,
    duplicateCount,
    rejectedCount,
  }
}

export default async function scheduleCommandWorker(_request: Request, context: Context) {
  const raw = Netlify.env.get('SCHEDULE_ASSISTANT_COMMAND') || ''
  if (!raw.trim()) return

  const parsed = parseScheduleCommand(raw)
  if (!parsed.ok) {
    console.warn('schedule-command-worker ignored invalid command:', parsed.message)
    return
  }

  const command = parsed.command
  const store = getStore({ name: 'schedule-command-worker', consistency: 'strong' })
  const processedKey = `processed/${command.commandId}`
  const existing = await store.get(processedKey, { type: 'json' })
  if (existing) {
    console.log(`schedule-command-worker already processed ${command.commandId}`)
    return
  }

  const token = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''
  if (!token) {
    console.error('schedule-command-worker missing SCHEDULE_ASSISTANT_TOKEN')
    return
  }

  const body = command.action === 'publish-shifts'
    ? { action: command.action, shifts: command.shifts, requestId: command.commandId }
    : { action: command.action, requestId: command.commandId }

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
  await store.setJSON(processedKey, result)
  console.log(`schedule-command-worker processed ${command.commandId}`)
}

export const config: Config = {
  schedule: '* * * * *',
}
