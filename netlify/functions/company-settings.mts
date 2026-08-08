import type { Config, Context } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  writeCompanyLogoSettings,
  writeCompanySettings,
} from './_shared/company-settings.mts'
import { resetCustomPdfLogo, saveCustomPdfLogo } from './_shared/pdf-branding.mts'
import { requirePortalRole } from './_shared/portal-role.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' } })
}

export default async function companySettings(request: Request, _context: Context) {
  const access = await requirePortalRole(['owner', 'admin'])
  if (access.response) return access.response
  const current = access.current!
  if (!['owner', 'admin'].includes(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)

  if (request.method === 'GET') return json({ settings: await readCompanySettings() })
  if (request.method !== 'PUT') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }

  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

    const hasLogoUpload = typeof body.pdfLogoDataUrl === 'string' && Boolean(String(body.pdfLogoDataUrl).trim())
    const hasLogoReset = body.resetPdfLogo === true
    if ((hasLogoUpload || hasLogoReset) && current.role !== 'owner') {
      return json({ message: 'Nur der Hauptadmin darf das Firmenlogo ändern.' }, 403)
    }
    if (hasLogoUpload && hasLogoReset) {
      return json({ message: 'Logo hochladen und zurücksetzen kann nicht gleichzeitig ausgeführt werden.' }, 400)
    }

    const hasTextSettings = ['companyName', 'phone', 'email', 'address'].some((key) => Object.prototype.hasOwnProperty.call(body, key))
    let settings = hasTextSettings
      ? await writeCompanySettings(body, { userId: current.userId })
      : await readCompanySettings()

    if (hasLogoUpload) {
      const savedLogo = await saveCustomPdfLogo(String(body.pdfLogoDataUrl))
      settings = await writeCompanyLogoSettings(savedLogo, { userId: current.userId })
    } else if (hasLogoReset) {
      await resetCustomPdfLogo()
      settings = await writeCompanyLogoSettings({
        logoUrl: DEFAULT_COMPANY_SETTINGS.logoUrl,
        logoVersion: '',
        logoUpdatedAt: '',
      }, { userId: current.userId })
    }

    return json({ settings })
  } catch (error) {
    if (error instanceof TypeError) return json({ message: error.message }, 400)
    console.error('Company settings', error)
    return json({ message: 'Die Firmendaten konnten nicht gespeichert werden.' }, 500)
  }
}

export const config: Config = { path: '/api/company-settings' }
