import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { EXPORT_LOGO_PNG_BASE64 } from './export-logo.mts'

const STORE_NAME = 'portal-pdf-branding'
const LOGO_KEY = 'company/current-logo.png'
const MAX_LOGO_BYTES = 4 * 1024 * 1024
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a'

function brandingStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

function hasPngSignature(bytes: Uint8Array) {
  if (bytes.byteLength < 8) return false
  return Buffer.from(bytes.subarray(0, 8)).toString('hex') === PNG_SIGNATURE_HEX
}

function defaultLogoBytes() {
  return new Uint8Array(Buffer.from(EXPORT_LOGO_PNG_BASE64, 'base64'))
}

export function decodePdfLogoDataUrl(dataUrl: string) {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new TypeError('Das PDF-Logo muss als transparentes PNG gespeichert werden.')
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
  } catch {
    throw new TypeError('Das PDF-Logo konnte nicht gelesen werden.')
  }
  if (bytes.byteLength < 32) throw new TypeError('Das PDF-Logo ist leer oder beschädigt.')
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new TypeError('Das PDF-Logo ist zu groß. Bitte ein kleineres Bild verwenden.')
  if (!hasPngSignature(bytes)) throw new TypeError('Das PDF-Logo ist keine gültige PNG-Datei.')
  return bytes
}

export async function readPdfLogoBytes(): Promise<{ bytes: Uint8Array; mimeType: 'image/png'; source: 'custom' | 'default' }> {
  try {
    const stored = await brandingStore().get(LOGO_KEY, { type: 'arrayBuffer' }) as ArrayBuffer | null
    if (stored) {
      const bytes = new Uint8Array(stored)
      if (hasPngSignature(bytes)) return { bytes, mimeType: 'image/png', source: 'custom' }
    }
  } catch (error) {
    console.warn('PDF branding blob read failed; using default logo', error)
  }
  return { bytes: defaultLogoBytes(), mimeType: 'image/png', source: 'default' }
}

export async function saveCustomPdfLogo(dataUrl: string) {
  const bytes = decodePdfLogoDataUrl(dataUrl)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  await brandingStore().set(LOGO_KEY, buffer)
  const logoVersion = randomUUID()
  return {
    logoUrl: `/api/company-logo?v=${encodeURIComponent(logoVersion)}`,
    logoVersion,
    logoUpdatedAt: new Date().toISOString(),
  }
}

export async function resetCustomPdfLogo() {
  await brandingStore().delete(LOGO_KEY)
}
