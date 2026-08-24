import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  writeCompanyLogoSettings,
  writeCompanySettings,
} from './company-settings.mts'
import { resetCustomPdfLogo, saveCustomPdfLogo } from './pdf-branding.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

const RELAY_ACTOR_ID = 'portal-admin-relay'

type CompanyAdminRole = 'owner' | 'admin'

function safeSettings(settings: Awaited<ReturnType<typeof readCompanySettings>>) {
  return {
    companyName: settings.companyName,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    logoUrl: settings.logoUrl,
    logoVersion: settings.logoVersion || '',
    logoUpdatedAt: settings.logoUpdatedAt || '',
    updatedAt: settings.updatedAt || '',
    updatedBy: settings.updatedBy || '',
  }
}

export function createCompanyPortalAdminHandler(actorRole: CompanyAdminRole = 'owner'): PortalAdminHandler {
  return async (operation) => {
    try {
      if (operation.action === 'get') {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { settings: safeSettings(await readCompanySettings()) },
        }
      }

      if (operation.action === 'update') {
        const settings = await writeCompanySettings(operation.input, { userId: RELAY_ACTOR_ID })
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { settings: safeSettings(settings) },
        }
      }

      if (operation.action === 'set-logo') {
        if (actorRole !== 'owner') {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'OWNER_REQUIRED',
          }
        }
        const dataUrl = String(operation.input.pdfLogoDataUrl || '').trim()
        if (!dataUrl) {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'LOGO_REQUIRED',
          }
        }
        const savedLogo = await saveCustomPdfLogo(dataUrl)
        const settings = await writeCompanyLogoSettings(savedLogo, { userId: RELAY_ACTOR_ID })
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { settings: safeSettings(settings) },
        }
      }

      if (operation.action === 'reset-logo') {
        if (actorRole !== 'owner') {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'OWNER_REQUIRED',
          }
        }
        await resetCustomPdfLogo()
        const settings = await writeCompanyLogoSettings({
          logoUrl: DEFAULT_COMPANY_SETTINGS.logoUrl,
          logoVersion: '',
          logoUpdatedAt: '',
        }, { userId: RELAY_ACTOR_ID })
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { settings: safeSettings(settings) },
        }
      }

      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'INVALID_COMPANY_SETTINGS',
        }
      }
      throw error
    }
  }
}
