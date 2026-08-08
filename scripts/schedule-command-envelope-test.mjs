import assert from 'node:assert/strict'
import {
  createCipheriv,
  createPrivateKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'
import { decryptScheduleCommandEnvelope } from './schedule-command-envelope-crypto.mjs'
import { decryptScheduleCommandEnvelopeRuntime } from '../netlify/functions/_shared/schedule-command-envelope-runtime.mts'

function encrypt(payload, publicKeyPem) {
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const encryptedKey = publicEncrypt({ key: publicKeyPem, oaepHash: 'sha256' }, aesKey)
  return {
    version: 1,
    state: 'command',
    algorithm: 'RSA-OAEP-256+A256GCM',
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
const privateKeyDer = createPrivateKey(privateKey).export({ format: 'der', type: 'pkcs8' })

const payload = {
  version: 1,
  commandId: 'command-123',
  createdAt: '2026-08-07T21:40:00.000Z',
  action: 'sync-directory',
}
const envelope = encrypt(payload, publicKey)
assert.deepEqual(decryptScheduleCommandEnvelope(envelope, privateKey), payload)
assert.deepEqual(decryptScheduleCommandEnvelopeRuntime(envelope, privateKey), payload)
assert.deepEqual(decryptScheduleCommandEnvelopeRuntime(envelope, privateKeyDer), payload)
assert.throws(() => decryptScheduleCommandEnvelope({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, privateKey))
assert.throws(() => decryptScheduleCommandEnvelopeRuntime({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, privateKeyDer))
assert.throws(() => decryptScheduleCommandEnvelope({ ...envelope, algorithm: 'wrong' }, privateKey))
assert.throws(() => decryptScheduleCommandEnvelopeRuntime({ ...envelope, algorithm: 'wrong' }, privateKeyDer))
assert.throws(() => decryptScheduleCommandEnvelope({ state: 'idle' }, privateKey))
assert.throws(() => decryptScheduleCommandEnvelopeRuntime({ state: 'idle' }, privateKeyDer))

console.log('Encrypted schedule command envelope tests passed')
