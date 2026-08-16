import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { currentPortalActor } from './_shared/portal-role.mts'
import {
  pushPublicKey,
  readPushMessage,
  registerPushDevice,
  sendPortalPush,
  unregisterPushDevice,
} from './_shared/push-core.mts'

const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])

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

export default async function push(request: Request, _context: Context) {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.searchParams.get('resource') === 'public-key') {
    const publicKey = pushPublicKey()
    if (!publicKey) return json({ message: 'Push ist noch nicht konfiguriert.' }, 503)
    return json({ publicKey })
  }

  if (request.method === 'GET' && url.searchParams.get('resource') === 'message') {
    const token = String(url.searchParams.get('token') || '').trim()
    if (!token) return json({ message: 'Geräte-Token fehlt.' }, 400)
    const message = await readPushMessage(token)
    return json({ message })
  }

  const current = await currentPortalActor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)

  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
  const action = String(body.action || '').trim()

  if (action === 'subscribe') {
    const subscription = body.subscription as { endpoint?: unknown } | null
    const endpoint = String(subscription?.endpoint || '').trim()
    if (!endpoint) return json({ message: 'Push-Abonnement fehlt.' }, 400)
    try {
      return json(await registerPushDevice({ userId: current.userId, email: current.email, role: current.role }, endpoint), 201)
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : 'Push konnte nicht aktiviert werden.' }, 400)
    }
  }

  if (action === 'unsubscribe') {
    const token = String(body.deviceToken || '').trim()
    if (!token) return json({ removed: false })
    return json({ removed: await unregisterPushDevice({ userId: current.userId, email: current.email, role: current.role }, token) })
  }

  if (action === 'send') {
    if (!MANAGEMENT.has(String(current.role))) return json({ message: 'Keine Berechtigung.' }, 403)
    const targetUserId = String(body.targetUserId || '').trim() || undefined
    try {
      const result = await sendPortalPush({
        actorRole: String(current.role),
        targetUserId,
        title: String(body.title || 'Habun Mitarbeiterportal'),
        body: String(body.message || ''),
        url: String(body.url || '/'),
      })
      return json(result)
    } catch (error) {
      if (error instanceof TypeError) return json({ message: error.message }, 400)
      console.error('Portal push send', error)
      return json({ message: 'Die Benachrichtigung konnte nicht gesendet werden.' }, 500)
    }
  }

  return json({ message: 'Unbekannte Push-Aktion.' }, 400)
}

export const config: Config = { path: '/api/push' }
