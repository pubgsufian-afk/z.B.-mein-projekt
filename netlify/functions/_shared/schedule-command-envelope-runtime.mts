import {
  constants,
  createDecipheriv,
  privateDecrypt,
} from 'node:crypto'

function requiredBase64(envelope: Record<string, unknown>, key: string) {
  const value = String(envelope[key] ?? '').trim()
  if (!value) throw new Error(`Schedule command envelope field fehlt: ${key}`)
  return Buffer.from(value, 'base64')
}

export function decryptScheduleCommandEnvelopeRuntime(envelope: unknown, privateKeyPem: string) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Schedule command envelope ist ungültig')
  }
  const value = envelope as Record<string, unknown>
  if (value.version !== 1 || value.state !== 'command') {
    throw new Error('Schedule command envelope ist nicht aktiv')
  }
  if (value.algorithm !== 'RSA-OAEP-256+A256GCM') {
    throw new Error('Schedule command envelope Algorithmus ist ungültig')
  }

  const privateKey = String(privateKeyPem || '').trim()
  if (!privateKey) throw new Error('Schedule command private key fehlt')

  const encryptedKey = requiredBase64(value, 'encryptedKey')
  const iv = requiredBase64(value, 'iv')
  const ciphertext = requiredBase64(value, 'ciphertext')
  const tag = requiredBase64(value, 'tag')

  const aesKey = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, encryptedKey)

  if (aesKey.length !== 32 || iv.length !== 12 || tag.length !== 16) {
    throw new Error('Schedule command envelope Parameter sind ungültig')
  }

  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')

  const payload = JSON.parse(plaintext)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Schedule command payload ist ungültig')
  }
  return payload as Record<string, unknown>
}
