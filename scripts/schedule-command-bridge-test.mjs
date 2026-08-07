import assert from 'node:assert/strict'
import { createCipheriv, generateKeyPairSync, publicEncrypt, randomBytes } from 'node:crypto'
import {
  decryptScheduleCommand,
  validateScheduleCommand,
} from '../netlify/functions/_shared/schedule-command-crypto.mts'

function encryptEnvelope(payload, publicKeyPem) {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const encryptedKey = publicEncrypt({
    key: publicKeyPem,
    oaepHash: 'sha256',
  }, key)

  return {
    v: 1,
    alg: 'RSA-OAEP-256+A256GCM',
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const now = new Date('2026-08-07T20:00:00.000Z')
const payload = {
  version: 1,
  commandId: 'cmd-123',
  createdAt: '2026-08-07T19:45:00.000Z',
  action: 'sync-directory',
}

const decrypted = decryptScheduleCommand(encryptEnvelope(payload, publicKey), privateKey)
assert.deepEqual(decrypted, payload)
assert.deepEqual(validateScheduleCommand(decrypted, now), { ok: true })

assert.equal(validateScheduleCommand({ ...payload, version: 2 }, now).ok, false)
assert.equal(validateScheduleCommand({ ...payload, commandId: '' }, now).ok, false)
assert.equal(validateScheduleCommand({ ...payload, action: 'delete-users' }, now).ok, false)
assert.equal(validateScheduleCommand({ ...payload, createdAt: '2026-08-07T18:00:00.000Z' }, now).ok, false)
assert.equal(validateScheduleCommand({ ...payload, createdAt: 'not-a-date' }, now).ok, false)

assert.throws(() => decryptScheduleCommand({ ...encryptEnvelope(payload, publicKey), tag: Buffer.alloc(16).toString('base64') }, privateKey))

console.log('Schedule command crypto tests passed')
