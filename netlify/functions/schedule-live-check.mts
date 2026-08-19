import { timingSafeEqual } from 'node:crypto'
import type { Config, Context } from '@netlify/functions'
import scheduleAssistant from './schedule-assistant.mts'

function secureTokenMatches(expected: string, provided: string) {
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  return left.length === right.length && timingSafeEqual(left, right)
}

export default async function scheduleLiveCheck(request: Request, context: Context) {
  const expected = Netlify.env.get('SCHEDULE_LIVE_CHECK_TOKEN') || ''
  const url = new URL(request.url)
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key') || ''
  if (!expected || !provided || !secureTokenMatches(expected, provided)) {
    return Response.json({ message: 'Nicht erlaubt.' }, { status: 401 })
  }

  const internalToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''
  if (!internalToken) {
    return Response.json({ message: 'Dienstplan-Assistent nicht konfiguriert.' }, { status: 503 })
  }

  const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${internalToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'list-shifts',
      from: '2026-08-20',
      to: '2026-08-20',
      requestId: 'live-check-2026-08-20',
    }),
  }), context)

  const text = await response.text()
  return new Response(text, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const config: Config = {
  path: '/api/schedule-live-check',
}
