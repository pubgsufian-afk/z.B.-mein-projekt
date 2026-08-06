import { getStore } from '@netlify/blobs'

export type CompanySettings = {
  companyName: string
  phone: string
  email: string
  logoUrl: string
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  companyName: 'Habun Security',
  phone: '',
  email: '',
  logoUrl: '/habun-logo.png',
}

const STORE_NAME = 'portal-company-settings'
const KEY = 'company/settings'

function clean(value: unknown, maximum = 180) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

export function normalizeCompanySettings(input: Record<string, unknown>, audit: { userId?: string } = {}): CompanySettings {
  const companyName = clean(input.companyName, 120)
  const phone = clean(input.phone, 60)
  const email = clean(input.email, 160).toLowerCase()
  const logoUrl = clean(input.logoUrl || '/habun-logo.png', 240)
  if (!companyName) throw new TypeError('Der Firmenname ist erforderlich.')
  if (!phone) throw new TypeError('Die Telefonnummer ist erforderlich.')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError('Die E-Mail-Adresse ist ungültig.')
  if (!logoUrl.startsWith('/') || logoUrl.includes('..') || /^\/\//.test(logoUrl)) throw new TypeError('Der Logo-Pfad ist ungültig.')
  return {
    companyName,
    phone,
    email,
    logoUrl,
    updatedAt: new Date().toISOString(),
    updatedBy: clean(audit.userId, 120),
  }
}

export async function readCompanySettings(): Promise<CompanySettings> {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  const stored = await store.get(KEY, { type: 'json' }) as Partial<CompanySettings> | null
  return {
    ...DEFAULT_COMPANY_SETTINGS,
    ...(stored || {}),
    companyName: clean(stored?.companyName || DEFAULT_COMPANY_SETTINGS.companyName, 120),
    phone: clean(stored?.phone || '', 60),
    email: clean(stored?.email || '', 160),
    logoUrl: clean(stored?.logoUrl || DEFAULT_COMPANY_SETTINGS.logoUrl, 240),
  }
}

export async function writeCompanySettings(input: Record<string, unknown>, audit: { userId?: string } = {}) {
  const settings = normalizeCompanySettings(input, audit)
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  await store.setJSON(KEY, settings)
  return settings
}
