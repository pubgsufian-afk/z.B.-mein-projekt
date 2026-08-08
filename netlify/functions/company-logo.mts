import type { Config, Context } from '@netlify/functions'
import { requirePortalRole } from './_shared/portal-role.mts'
import { readPdfLogoBytes } from './_shared/pdf-branding.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export default async function companyLogo(request: Request, _context: Context) {
  const access = await requirePortalRole(['owner', 'admin'])
  if (access.response) return access.response
  if (request.method !== 'GET') return json({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    const logo = await readPdfLogoBytes()
    return new Response(logo.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    console.error('Company logo', error)
    return json({ message: 'Das Firmenlogo konnte nicht geladen werden.' }, 500)
  }
}

export const config: Config = { path: '/api/company-logo' }
