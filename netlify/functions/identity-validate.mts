import type { Handler, HandlerEvent } from '@netlify/functions'
import { connectLambda } from '@netlify/blobs'
import { findRegistrationEmailConflict, normalizeRegistrationEmail, readPortalRegistrationIdentities } from './_shared/registration-email-guard.mts'

/**
 * Reject a second signup before a new Netlify Identity account is created.
 * Existing employees must recover their password instead of signing up again.
 */
const handler: Handler = async (event: HandlerEvent) => {
  let data: { user?: { id?: string; email?: string } } = {}
  try {
    data = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: 'Ungültige Registrierungsdaten.' }
  }

  const email = normalizeRegistrationEmail(data.user?.email)
  if (!email) return { statusCode: 400, body: 'Bitte eine gültige E-Mail-Adresse eingeben.' }

  try {
    // Legacy Netlify Identity webhooks run in Lambda compatibility mode.
    // Blobs must be connected to this invocation before reading registrations.
    connectLambda(event)
    const existing = await readPortalRegistrationIdentities()
    // There is no account ID yet in the validate event. Any pending or approved
    // record for this mailbox means the person must use the existing account.
    const probe = { id: '__new_signup__', email, status: 'pending', createdAt: '9999-12-31T23:59:59Z' }
    if (findRegistrationEmailConflict(probe, existing)) {
      return {
        statusCode: 409,
        body: 'Diese E-Mail-Adresse wurde bereits verwendet. Bitte anmelden oder „Passwort vergessen“ nutzen.',
      }
    }
    return { statusCode: 200, body: '{}' }
  } catch (error) {
    // Do not log the signup payload or employee email.
    console.error('[identity-validate] Registration lookup failed', error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error')
    return { statusCode: 503, body: 'Registrierung vorübergehend nicht verfügbar. Bitte später erneut versuchen.' }
  }
}

export { handler }
