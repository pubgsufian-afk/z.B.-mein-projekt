import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/_shared/portal-admin-export-spool.mts', 'utf8')
for (const needle of [
  "name: 'portal-admin-export-spool'",
  'encryptPortalAdminExport',
  'expiresAt',
  '15 * 60 * 1000',
  'consumePortalAdminExport',
  '.delete(key)',
  'EXPORT_EXPIRED',
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.doesNotMatch(source, /console\.log/)

console.log('portal admin export spool source tests passed')
