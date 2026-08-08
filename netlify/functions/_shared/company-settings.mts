import { getStore } from '@netlify/blobs'

export type CompanySettings = {
  companyName: string
  phone: string
  email: string
  address: string
  logoUrl: string
  logoVersion?: string
  logoUpdatedAt?: string
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  companyName: 'HABUN Security & Gebäudereinigung',
  phone: '+49 1573 3967124',
  email: 'info@habun-security.de',
  address: 'Ringstraße 7, 30457 Hannover',
  logoUrl: '/habun-logo.png',
  logoVersion: '',
  logoUpdatedAt: '',
}

const STORE_NAME = 'portal-company-settings'
const KEY = 'company/settings'

function clean(value: unknown, maximum = 180) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function validLogoUrl(value: unknown) {
  const logoUrl = clean(value || DEFAULT_COMPANY_SETTINGS.logoUrl, 300)
  if (!logoUrl.startsWith('/') || logoUrl.includes('..') || /^\/\//.test(logoUrl)) throw new TypeError('Der Logo-Pfad ist ungültig.')
  return logoUrl
}

export function normalizeCompanySettings(
  input: Record<string, unknown>,
  audit: { userId?: string } = {},
  current: CompanySettings = DEFAULT_COMPANY_SETTINGS,
): CompanySettings {
  const companyName = clean(input.companyName || current.companyName || DEFAULT_COMPANY_SETTINGS.companyName, 120)
  const phone = clean(input.phone || current.phone || DEFAULT_COMPANY_SETTINGS.phone, 60)
  const email = clean(input.email || current.email || DEFAULT_COMPANY_SETTINGS.email, 160).toLowerCase()
  const address = clean(input.address || current.address || DEFAULT_COMPANY_SETTINGS.address, 180)
  if (!companyName) throw new TypeError('Der Firmenname ist erforderlich.')
  if (!phone) throw new TypeError('Die Telefonnummer ist erforderlich.')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError('Die E-Mail-Adresse ist ungültig.')
  if (!address) throw new TypeError('Die Firmenadresse ist erforderlich.')
  return {
    companyName,
    phone,
    email,
    address,
    logoUrl: validLogoUrl(current.logoUrl),
    logoVersion: clean(current.logoVersion, 120),
    logoUpdatedAt: clean(current.logoUpdatedAt, 80),
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
    phone: clean(stored?.phone || DEFAULT_COMPANY_SETTINGS.phone, 60),
    email: clean(stored?.email || DEFAULT_COMPANY_SETTINGS.email, 160),
    address: clean(stored?.address || DEFAULT_COMPANY_SETTINGS.address, 180),
    logoUrl: validLogoUrl(stored?.logoUrl || DEFAULT_COMPANY_SETTINGS.logoUrl),
    logoVersion: clean(stored?.logoVersion, 120),
    logoUpdatedAt: clean(stored?.logoUpdatedAt, 80),
  }
}

export async function writeCompanySettings(input: Record<string, unknown>, audit: { userId?: string } = {}) {
  const current = await readCompanySettings()
  const settings = normalizeCompanySettings(input, audit, current)
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  await store.setJSON(KEY, settings)
  return settings
}

export async function writeCompanyLogoSettings(
  input: { logoUrl: string; logoVersion?: string; logoUpdatedAt?: string },
  audit: { userId?: string } = {},
) {
  const current = await readCompanySettings()
  const settings: CompanySettings = {
    ...current,
    logoUrl: validLogoUrl(input.logoUrl),
    logoVersion: clean(input.logoVersion, 120),
    logoUpdatedAt: clean(input.logoUpdatedAt, 80),
    updatedAt: new Date().toISOString(),
    updatedBy: clean(audit.userId, 120),
  }
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })
  await store.setJSON(KEY, settings)
  return settings
}
