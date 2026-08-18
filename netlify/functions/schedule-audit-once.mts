import type { Config, Context } from '@netlify/functions'
import { timingSafeEqual } from 'node:crypto'
import scheduleAssistant from './schedule-assistant.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

function secureEqual(received: string, expected: string) {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right)
}

async function callAssistant(body: Record<string, unknown>, context: Context) {
  const assistantToken = String(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || '').trim()
  if (!assistantToken) return json({ message: 'Dienstplan-Verbindung fehlt.' }, 500)
  return scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }), context)
}

export default async function scheduleAuditOnce(request: Request, context: Context) {
  if (request.method !== 'GET') return json({ message: 'Methode nicht erlaubt.' }, 405)

  const url = new URL(request.url)
  const expected = String(Netlify.env.get('SCHEDULE_AUDIT_TOKEN') || '')
  const received = String(url.searchParams.get('token') || '')
  if (!secureEqual(received, expected)) return json({ message: 'Nicht autorisiert.' }, 401)

  const action = String(url.searchParams.get('action') || 'list')
  if (action === 'list') {
    const from = String(url.searchParams.get('from') || '2026-08-01')
    const to = String(url.searchParams.get('to') || '2026-08-19')
    return callAssistant({ action: 'list-shifts', from, to, status: 'published', requestId: crypto.randomUUID() }, context)
  }

  if (action === 'apply') {
    let corrections: Array<{ shiftId?: unknown; changes?: unknown }> = []
    try {
      const parsed = JSON.parse(String(Netlify.env.get('SCHEDULE_AUDIT_CORRECTIONS') || '[]'))
      if (Array.isArray(parsed)) corrections = parsed
    } catch {
      return json({ message: 'Korrekturliste ist ungültig.' }, 500)
    }
    if (!corrections.length) return json({ message: 'Keine Korrekturen hinterlegt.' }, 400)

    const results: Array<Record<string, unknown>> = []
    for (const item of corrections.slice(0, 100)) {
      const shiftId = String(item?.shiftId || '').trim()
      const changes = item?.changes && typeof item.changes === 'object' && !Array.isArray(item.changes)
        ? item.changes as Record<string, unknown>
        : {}
      if (!shiftId || !Object.keys(changes).length) {
        results.push({ shiftId, ok: false, status: 400, message: 'Ungültige Korrektur.' })
        continue
      }
      const response = await callAssistant({ action: 'update-shift', shiftId, changes, requestId: crypto.randomUUID() }, context)
      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      results.push({ shiftId, ok: response.ok, status: response.status, data })
    }
    return json({ applied: results.filter((entry) => entry.ok === true).length, total: results.length, results })
  }

  return json({ message: 'Unbekannte Aktion.' }, 400)
}

export const config: Config = { path: '/api/schedule-audit-once' }
