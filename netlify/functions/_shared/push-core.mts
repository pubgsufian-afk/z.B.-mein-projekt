import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
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

type VapidJwk = {
  kty: string
  crv: string
  x: string
  y: string
  d: string
}

type VapidConfig = {
  publicKey: string
  privateJwk: VapidJwk
  createdAt: string
}

const STORE_NAME = 'portal-push-devices-v1'
const VAPID_KEY = 'config/vapid'
const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

function base64Url(buffer: Buffer | Uint8Array | string) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function validVapidConfig(value: unknown): value is VapidConfig {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<VapidConfig>
  const jwk = row.privateJwk as Partial<VapidJwk> | undefined
  return Boolean(row.publicKey && jwk?.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y && jwk.d)
}

async function vapidConfig() {
  const current = store()
  const existing = await current.get(VAPID_KEY, { type: 'json' }) as VapidConfig | null
  if (validVapidConfig(existing)) return existing

  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicJwk = pair.publicKey.export({ format: 'jwk' })
  const privateJwk = pair.privateKey.export({ format: 'jwk' })
  if (!publicJwk.x || !publicJwk.y || !privateJwk.x || !privateJwk.y || !privateJwk.d) {
    throw new Error('Push-Schlüssel konnten nicht erzeugt werden.')
  }

  const publicKey = base64Url(Buffer.concat([
    Buffer.from([4]),
    decodeBase64Url(publicJwk.x),
    decodeBase64Url(publicJwk.y),
  ]))
  const config: VapidConfig = {
    publicKey,
    privateJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: privateJwk.x,
      y: privateJwk.y,
      d: privateJwk.d,
    },
    createdAt: new Date().toISOString(),
  }
  await current.setJSON(VAPID_KEY, config)
  const persisted = await current.get(VAPID_KEY, { type: 'json' }) as VapidConfig | null
  if (!validVapidConfig(persisted)) throw new Error('Push-Schlüssel konnten nicht gespeichert werden.')
  return persisted
}

export async function pushPublicKey() {
  return (await vapidConfig()).publicKey
}

function privateKey(config: VapidConfig) {
  return createPrivateKey({ key: config.privateJwk, format: 'jwk' })
}

function vapidAuthorization(endpoint: string, config: VapidConfig) {
  const audience = new URL(endpoint).origin
  const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = base64Url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'https://habun-mitarbeiterportal.netlify.app/',
  }))
  const unsigned = `${header}.${payload}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: privateKey(config),
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${unsigned}.${base64Url(signature)}, k=${config.publicKey}`
}

async function sendWake(endpoint: string, config: VapidConfig) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(endpoint, config),
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

export async function registerPushDevice(actor: PortalActor, endpoint: string, existingRawToken = '') {
  const cleanEndpoint = String(endpoint || '').trim()
  if (!cleanEndpoint.startsWith('https://')) throw new TypeError('Die Push-Registrierung ist ungültig.')

  const current = store()
  const cleanToken = String(existingRawToken || '').trim()
  if (cleanToken) {
    const tokenHash = sha256(cleanToken)
    const existingRecord = await current.get(`devices/${tokenHash}`, { type: 'json' }) as DeviceRecord | null
    if (existingRecord?.userId === actor.userId && existingRecord.endpoint === cleanEndpoint) {
      await current.setJSON(`devices/${tokenHash}`, {
        ...existingRecord,
        email: String(actor.email || ''),
        role: String(actor.role || ''),
        updatedAt: new Date().toISOString(),
      })
      return { deviceToken: cleanToken, reused: true }
    }
  }

  const existing = await listDevices()
  for (const row of existing) {
    if (row.endpoint === cleanEndpoint) await current.delete(`devices/${row.tokenHash}`)
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
  await current.setJSON(`devices/${tokenHash}`, record)
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

export async function sendDeviceTestPush(actor: PortalActor, rawToken: string) {
  const tokenHash = sha256(String(rawToken || ''))
  const key = `devices/${tokenHash}`
  const current = store()
  const device = await current.get(key, { type: 'json' }) as DeviceRecord | null
  if (!device || device.userId !== actor.userId) return { targeted: 0, delivered: 0, removed: 0 }

  const message: PushMessage = {
    id: crypto.randomUUID(),
    title: 'Habun Mitarbeiterportal',
    body: 'Benachrichtigungen funktionieren auf diesem Gerät.',
    url: '/',
    createdAt: new Date().toISOString(),
  }
  await current.setJSON(key, { ...device, latestMessage: message, updatedAt: new Date().toISOString() })

  try {
    const response = await sendWake(device.endpoint, await vapidConfig())
    if (response.ok) return { targeted: 1, delivered: 1, removed: 0, messageId: message.id }
    if (response.status === 404 || response.status === 410) {
      await current.delete(key)
      return { targeted: 1, delivered: 0, removed: 1, messageId: message.id }
    }
    console.warn('Push test rejected', response.status, device.endpoint.slice(0, 80))
    return { targeted: 1, delivered: 0, removed: 0, messageId: message.id }
  } catch (error) {
    console.warn('Push test failed', error)
    return { targeted: 1, delivered: 0, removed: 0, messageId: message.id }
  }
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
  const config = await vapidConfig()
  let delivered = 0
  let removed = 0

  for (const device of devices) {
    const key = `devices/${device.tokenHash}`
    await store().setJSON(key, { ...device, latestMessage: message, updatedAt: new Date().toISOString() })
    try {
      const response = await sendWake(device.endpoint, config)
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
