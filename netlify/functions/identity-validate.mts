import { findRegistrationEmailConflict, normalizeRegistrationEmail, readPortalRegistrationIdentities } from './_shared/registration-email-guard.mts'

/**
 * Netlify Identity validation hook. Use the modern Request/Response handler:
 * Netlify automatically provides the Blobs context, unlike the legacy Lambda API.
 * Fail closed when the registration directory cannot be checked.
 */
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('Methode nicht erlaubt.', { status: 405 })
  }

  const data = await request.json().catch(() => null) as { user?: { email?: string } } | null
  const email = normalizeRegistrationEmail(data?.user?.email)
  if (!email) {
    return new Response('Bitte gültige Registrierungsdaten übermitteln.', { status: 400 })
  }

  try {
    const existing = await readPortalRegistrationIdentities()
    // Any older pending or approved registration blocks a second signup.
    // Approval rechecks this condition, too.
    const probe = { id: '__new_signup__', email, status: 'pending', createdAt: '9999-12-31T23:59:59Z' }
    if (findRegistrationEmailConflict(probe, existing)) {
      return new Response('Diese E-Mail-Adresse wurde bereits verwendet. Bitte anmelden oder „Passwort vergessen“ nutzen.', { status: 409 })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    // Never log the applicant email, password or the webhook payload.
    console.error('[identity-validate] Registration lookup failed', error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error')
    return new Response('Registrierung vorübergehend nicht verfügbar. Bitte später erneut versuchen.', { status: 503 })
  }
}
