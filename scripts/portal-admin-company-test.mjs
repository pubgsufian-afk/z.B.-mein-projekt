import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/_shared/portal-admin-company.mts', 'utf8')

for (const needle of [
  'readCompanySettings',
  'writeCompanySettings',
  'saveCustomPdfLogo',
  'resetCustomPdfLogo',
  'writeCompanyLogoSettings',
  "operation.action === 'get'",
  "operation.action === 'update'",
  "operation.action === 'set-logo'",
  "operation.action === 'reset-logo'",
  'OWNER_REQUIRED',
]) assert.ok(source.includes(needle), `missing ${needle}`)

assert.match(source, /actorRole !== 'owner'/)
assert.doesNotMatch(source, /LOGO_KEY|brandingStore|portal-pdf-branding/)
assert.doesNotMatch(source, /console\.log\([^\n]*(pdfLogoDataUrl|logoVersion)/i)

console.log('portal admin company tests passed')
