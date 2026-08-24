import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type PortalAdminEncryptedExport = {
  version: 1
  algorithm: 'A256GCM'
  filename: string
  contentType: string
  iv: string
  tag: string
  ciphertext: string
}

function clean(value: unknown, max: number) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function responseKeyBytes(encodedKey: string) {
  const key = Buffer.from(String(encodedKey || '').trim(), 'base64')
  if (key.length !== 32) throw new TypeError('Ungültiger Export-Antwortschlüssel.')
  return key
}

export function encryptPortalAdminExport(input: {
  bytes: Uint8Array
  responseKey: string
  filename: string
  contentType: string
}): PortalAdminEncryptedExport {
  const key = responseKeyBytes(input.responseKey)
  const filename = clean(input.filename, 180)
  const contentType = clean(input.contentType, 120)
  if (!filename || !contentType) throw new TypeError('Export-Metadaten sind ungültig.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(input.bytes)), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    version: 1,
    algorithm: 'A256GCM',
    filename,
    contentType,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptPortalAdminExportForTest(envelope: PortalAdminEncryptedExport, encodedKey: string) {
  const key = responseKeyBytes(encodedKey)
  if (envelope.version !== 1 || envelope.algorithm !== 'A256GCM') throw new TypeError('Export-Envelope ist ungültig.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return new Uint8Array(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]))
}
