import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import {
  encryptPortalAdminExport,
  type PortalAdminEncryptedExport,
} from './portal-admin-export-envelope.mts'

const EXPORT_TTL_MS = 15 * 60 * 1000
const STORE_NAME = 'portal-admin-export-spool'

type StoredPortalAdminExport = {
  createdAt: string
  expiresAt: string
  envelope: PortalAdminEncryptedExport
}

export class PortalAdminExportSpoolError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'PortalAdminExportSpoolError'
    this.code = code
    this.status = status
  }
}

function exportStore() {
  return getStore({ name: 'portal-admin-export-spool', consistency: 'strong' })
}

function exportKey(handle: string) {
  const normalized = String(handle || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) {
    throw new PortalAdminExportSpoolError('Export-Handle ist ungültig.', 'INVALID_EXPORT_HANDLE', 400)
  }
  return `exports/${normalized}`
}

export async function spoolPortalAdminExport(input: {
  bytes: Uint8Array
  responseKey: string
  filename: string
  contentType: string
}) {
  const handle = randomUUID()
  const now = Date.now()
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + EXPORT_TTL_MS).toISOString()
  const envelope = encryptPortalAdminExport(input)
  const record: StoredPortalAdminExport = { createdAt, expiresAt, envelope }
  await exportStore().setJSON(exportKey(handle), record)
  return {
    handle,
    filename: envelope.filename,
    contentType: envelope.contentType,
    encryptedBytes: Buffer.byteLength(JSON.stringify(envelope), 'utf8'),
    expiresAt,
  }
}

export async function consumePortalAdminExport(handle: string) {
  const store = exportStore()
  const key = exportKey(handle)
  const record = await store.get(key, { type: 'json' }) as StoredPortalAdminExport | null
  if (!record?.envelope) {
    throw new PortalAdminExportSpoolError('Export wurde nicht gefunden.', 'EXPORT_NOT_FOUND', 404)
  }

  await store.delete(key)
  const expiresAt = Date.parse(String(record.expiresAt || ''))
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new PortalAdminExportSpoolError('Export ist abgelaufen.', 'EXPORT_EXPIRED', 410)
  }

  const payload = Buffer.from(JSON.stringify(record.envelope), 'utf8')
  return {
    bytes: new Uint8Array(payload),
    filename: record.envelope.filename,
    contentType: record.envelope.contentType,
    expiresAt: record.expiresAt,
  }
}

export const portalAdminExportSpoolStoreName = STORE_NAME
