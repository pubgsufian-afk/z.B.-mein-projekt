import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto'
import { getStore } from '@netlify/blobs'

type PortalActor = { userId: string; email?: string; role?: string }

type PushMessage = {
  id: string
  title: string
  body: string
  url: string
  createdAt: string
}

type DeviceRecord = {
  tokenHash: string
  endpoint: string
  userId: string
  email: string
  role: string
  createdAt: string
  updatedAt: string
  latestMessage?: PushMessage | null
}

const STORE_NAME = 'portal-push-devices-v1'
const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

function base64Url(buffer: Buffer | Uint8Array | string) {
  const bytes = typeof buffer === 'string' ? Buffer.from(buffer) : Buffer.from(buffer)
  return bytes.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function pushPublicKey() {
  return String(Netlify.env.get('PUSH_VAPID_PUBLIC_KEY') || '').trim()
}

function vapidPrivateKey() {
  const publicKey = decodeBase64Url(pushPublicKey())
  const privateD = String(Netlify.env.get('PUSH_VAPID_PRIVATE_KEY') || '').trim()
  if (publicKey.length !== 65 || publicKey[0] !== 4 || !privateD) throw new Error('Push-Schlüssel sind nicht vollständig konfiguriert.')
  const x = publicKey.subarray(1, 33)
  const y = publicKey.subarray(33, 65)
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: base64Url(x), y: base64Url(y), d: privateD },
    format: 'jwk',
  })
}

function vapidAuthorization(endpoint: string) {
  const audience = new URL(endpoint).origin
  const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = base64Url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'https://habun-mitarbeiterportal.netlify.app/',
  }))
  const unsigned = `${header}.${payload}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKey(),
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${unsigned}.${base64Url(signature)}, k=${pushPublicKey()}`
}

async function sendWake(endpoint: string) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(endpoint),
      TTL: '3600',
      Urgency: 'normal',
    },
    body: null,
  })
}

async function listDevices() {
  const current = store()
  const listed = await current.list({ prefix: 'devices/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => current.get(blob.key, { type: 'json' }) as Promise<DeviceRecord | null>),
  )
  return rows.filter((row): row is DeviceRecord => Boolean(row?.endpoint && row?.tokenHash && row?.userId))
}

export async function registerPushDevice(actor: PortalActor, endpoint: string) {
  const cleanEndpoint = String(endpoint || '').trim()
  if (!cleanEndpoint.startsWith('https://')) throw new TypeError('Die Push-Registrierung ist ungültig.')

  const existing = await listDevices()
  for (const row of existing) {
    if (row.endpoint === cleanEndpoint) {
      await store().delete(`devices/${row.tokenHash}`)
    }
  }

  const rawToken = `${crypto.randomUUID()}.${base64Url(randomBytes(24))}`
  const tokenHash = sha256(rawToken)
  const now = new Date().toISOString()
  const record: DeviceRecord = {
    tokenHash,
    endpoint: cleanEndpoint,
    userId: actor.userId,
    email: String(actor.email || ''),
    role: String(actor.role || ''),
    createdAt: now,
    updatedAt: now,
    latestMessage: null,
  }
  await store().setJSON(`devices/${tokenHash}`, record)
  return { deviceToken: rawToken, reused: false }
}

export async function unregisterPushDevice(actor: PortalActor, rawToken: string) {
  const tokenHash = sha256(String(rawToken || ''))
  const record = await store().get(`devices/${tokenHash}`, { type: 'json' }) as DeviceRecord | null
  if (!record || record.userId !== actor.userId) return false
  await store().delete(`devices/${tokenHash}`)
  return true
}

export async function readPushMessage(rawToken: string) {
  const tokenHash = sha256(String(rawToken || ''))
  const record = await store().get(`devices/${tokenHash}`, { type: 'json' }) as DeviceRecord | null
  if (!record?.latestMessage) return null
  return record.latestMessage
}

export async function sendPortalPush(options: {
  actorRole?: string
  targetUserId?: string
  title: string
  body: string
  url?: string
}) {
  if (options.actorRole && !MANAGEMENT.has(options.actorRole)) throw new Error('Keine Berechtigung.')
  const title = String(options.title || '').trim().slice(0, 80)
  const body = String(options.body || '').trim().slice(0, 300)
  const url = String(options.url || '/').trim() || '/'
  if (!title || !body) throw new TypeError('Titel und Nachricht sind erforderlich.')

  const devices = (await listDevices()).filter((row) => !options.targetUserId || row.userId === options.targetUserId)
  const message: PushMessage = { id: crypto.randomUUID(), title, body, url, createdAt: new Date().toISOString() }
  let delivered = 0
  let removed = 0

  for (const device of devices) {
    const key = `devices/${device.tokenHash}`
    await store().setJSON(key, { ...device, latestMessage: message, updatedAt: new Date().toISOString() })
    try {
      const response = await sendWake(device.endpoint)
      if (response.ok) delivered += 1
      else if (response.status === 404 || response.status === 410) {
        await store().delete(key)
        removed += 1
      } else {
        console.warn('Push service rejected request', response.status, device.endpoint.slice(0, 80))
      }
    } catch (error) {
      console.warn('Push delivery failed', error)
    }
  }

  return { targeted: devices.length, delivered, removed, messageId: message.id }
}
