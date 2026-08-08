import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
} from 'node:crypto'

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const GITHUB_OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks'
const EXPECTED_AUDIENCE = 'habun-schedule-assistant'
const EXPECTED_REPOSITORY = 'pubgsufian-afk/z.B.-mein-projekt'
const EXPECTED_REF = 'refs/heads/main'
const EXPECTED_SUBJECT = 'repo:pubgsufian-afk/z.B.-mein-projekt:ref:refs/heads/main'
const EXPECTED_WORKFLOW_REF = 'pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main'
const MAX_TOKEN_AGE_SECONDS = 10 * 60
const CLOCK_SKEW_SECONDS = 30

export type ScheduleGithubOidcClaims = {
  iss: string
  aud: string
  repository: string
  ref: string
  sub: string
  workflow_ref: string
  iat: number
  nbf: number
  exp: number
  [key: string]: unknown
}

type JwtHeader = {
  alg?: unknown
  kid?: unknown
  typ?: unknown
}

type JwksResponse = {
  keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>
}

type FetchLike = typeof fetch

function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object')
    return value as Record<string, unknown>
  } catch {
    throw new Error(`GitHub OIDC ${label} ist ungültig`)
  }
}

function exactString(claims: Record<string, unknown>, key: string, expected: string) {
  const actual = String(claims[key] ?? '')
  if (actual !== expected) throw new Error(`GitHub OIDC ${key} ist ungültig`)
  return actual
}

function finiteNumber(claims: Record<string, unknown>, key: string) {
  const value = Number(claims[key])
  if (!Number.isFinite(value)) throw new Error(`GitHub OIDC ${key} fehlt oder ist ungültig`)
  return value
}

export function validateScheduleGithubOidcClaims(
  claims: Record<string, unknown>,
  now = new Date(),
): ScheduleGithubOidcClaims {
  const iss = exactString({ issuer: claims.iss }, 'issuer', GITHUB_OIDC_ISSUER)
  const aud = exactString({ audience: claims.aud }, 'audience', EXPECTED_AUDIENCE)
  const repository = exactString(claims, 'repository', EXPECTED_REPOSITORY)
  const ref = exactString(claims, 'ref', EXPECTED_REF)
  const sub = exactString(claims, 'sub', EXPECTED_SUBJECT)
  const workflowRef = exactString(claims, 'workflow_ref', EXPECTED_WORKFLOW_REF)
  const iat = finiteNumber(claims, 'iat')
  const nbf = finiteNumber(claims, 'nbf')
  const exp = finiteNumber(claims, 'exp')
  const nowSeconds = Math.floor(now.getTime() / 1000)

  if (nbf > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('GitHub OIDC nbf: token is not active')
  if (exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new Error('GitHub OIDC exp: token expired')
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error('GitHub OIDC iat liegt in der Zukunft')
  if (nowSeconds - iat > MAX_TOKEN_AGE_SECONDS) throw new Error('GitHub OIDC token ist zu alt')

  return {
    ...claims,
    iss,
    aud,
    repository,
    ref,
    sub,
    workflow_ref: workflowRef,
    iat,
    nbf,
    exp,
  }
}

export async function verifyScheduleGithubOidc(
  token: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<ScheduleGithubOidcClaims> {
  const rawToken = String(token || '').trim()
  const parts = rawToken.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('GitHub OIDC token format ist ungültig')

  const [headerPart, payloadPart, signaturePart] = parts
  const header = decodeJsonSegment(headerPart, 'header') as JwtHeader
  if (header.alg !== 'RS256') throw new Error('GitHub OIDC algorithm muss RS256 sein')
  const kid = String(header.kid || '').trim()
  if (!kid) throw new Error('GitHub OIDC kid fehlt')

  const response = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`GitHub OIDC JWKS konnte nicht geladen werden (${response.status})`)
  const jwks = await response.json() as JwksResponse
  const jwk = Array.isArray(jwks.keys)
    ? jwks.keys.find((entry) => entry?.kid === kid && (!entry.alg || entry.alg === 'RS256') && (!entry.use || entry.use === 'sig'))
    : undefined
  if (!jwk) throw new Error('GitHub OIDC kid/key wurde nicht gefunden')

  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`)
  const signature = Buffer.from(signaturePart, 'base64url')
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
  if (!verifySignature('RSA-SHA256', signingInput, publicKey, signature)) {
    throw new Error('GitHub OIDC signature ist ungültig')
  }

  const claims = decodeJsonSegment(payloadPart, 'payload')
  return validateScheduleGithubOidcClaims(claims, now)
}
