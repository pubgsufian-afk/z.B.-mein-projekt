import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  verifyScheduleGithubOidc,
} from '../netlify/functions/_shared/schedule-github-oidc.mts'

const now = new Date('2026-08-08T00:55:00.000Z')
const nowSeconds = Math.floor(now.getTime() / 1000)
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const kid = 'test-kid-1'

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

function makeToken(overrides = {}, headerOverrides = {}, signingKey = privateKey) {
  const header = { alg: 'RS256', typ: 'JWT', kid, ...headerOverrides }
  const payload = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'habun-schedule-assistant',
    repository: 'pubgsufian-afk/z.B.-mein-projekt',
    ref: 'refs/heads/main',
    sub: 'repo:pubgsufian-afk/z.B.-mein-projekt:ref:refs/heads/main',
    workflow_ref: 'pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main',
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
    ...overrides,
  }
  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), signingKey).toString('base64url')
  return `${signingInput}.${signature}`
}

const fakeFetch = async (url) => {
  assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks')
  return Response.json({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] })
}

const validClaims = await verifyScheduleGithubOidc(makeToken(), now, fakeFetch)
assert.equal(validClaims.repository, 'pubgsufian-afk/z.B.-mein-projekt')
assert.equal(validClaims.ref, 'refs/heads/main')

await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ aud: 'wrong-audience' }), now, fakeFetch),
  /audience|aud/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ repository: 'other/repo' }), now, fakeFetch),
  /repository/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ ref: 'refs/heads/dev' }), now, fakeFetch),
  /ref/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ workflow_ref: 'other/workflow.yml@refs/heads/main' }), now, fakeFetch),
  /workflow/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ exp: nowSeconds - 60 }), now, fakeFetch),
  /expired|exp/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({ nbf: nowSeconds + 120 }), now, fakeFetch),
  /nbf|not active/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({}, { alg: 'HS256' }), now, fakeFetch),
  /RS256|algorithm/i,
)
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({}, { kid: 'unknown-kid' }), now, fakeFetch),
  /kid|key/i,
)

const { privateKey: attackerKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
await assert.rejects(
  () => verifyScheduleGithubOidc(makeToken({}, {}, attackerKey), now, fakeFetch),
  /signature/i,
)

console.log('Schedule GitHub OIDC tests passed')
