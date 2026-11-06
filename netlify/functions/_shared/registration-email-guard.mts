import { getStore } from '@netlify/blobs'

export type RegistrationIdentity = {
  id?: string
  email?: string
  status?: string
  createdAt?: string
}

export function normalizeRegistrationEmail(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

function registrationId(row: RegistrationIdentity) {
  return String(row.id ?? '').trim()
}

function requestOrder(row: RegistrationIdentity) {
  const parsed = Date.parse(String(row.createdAt ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * An approved identity must be reused (via password recovery), never approved again.
 * When two requests are pending for the same mailbox, only the oldest one may be approved.
 * Rejected requests do not block a later application.
 */
export function findRegistrationEmailConflict(
  target: RegistrationIdentity,
  registrations: RegistrationIdentity[],
): { id: string; status: string } | null {
  const email = normalizeRegistrationEmail(target.email)
  const id = registrationId(target)
  if (!id || !email) return null

  const colliding = registrations.filter((candidate) => (
    registrationId(candidate) !== id &&
    normalizeRegistrationEmail(candidate.email) === email &&
    ['approved', 'pending'].includes(String(candidate.status ?? '').toLowerCase())
  ))
  const approved = colliding.find((candidate) => String(candidate.status).toLowerCase() === 'approved')
  if (approved) return { id: registrationId(approved), status: 'approved' }

  const olderPending = colliding.find((candidate) => {
    const left = requestOrder(candidate)
    const right = requestOrder(target)
    return left < right || (left === right && registrationId(candidate) < id)
  })
  return olderPending ? { id: registrationId(olderPending), status: 'pending' } : null
}

/** Inspect all pages. Failing open is unsafe for registration approvals. */
export async function readPortalRegistrationIdentities(): Promise<RegistrationIdentity[]> {
  const store = getStore({ name: 'portal-registrations', consistency: 'strong' })
  const rows: RegistrationIdentity[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const result = await store.list({ prefix: 'registration/', ...(cursor ? { cursor } : {}) })
    const values = await Promise.all(
      result.blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<RegistrationIdentity | null>),
    )
    rows.push(...values.filter((row): row is RegistrationIdentity => Boolean(row)))
    if (!result.cursor) return rows
    cursor = result.cursor
  }
  throw new Error('Die Registrierungsdaten konnten nicht vollständig geprüft werden.')
}
