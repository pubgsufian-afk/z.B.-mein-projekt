import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  encryptPortalAdminExport,
  decryptPortalAdminExportForTest,
} from '../netlify/functions/_shared/portal-admin-export-envelope.mts'

const key = randomBytes(32).toString('base64')
const bytes = new TextEncoder().encode('habun-report-test')
const encrypted = encryptPortalAdminExport({
  bytes,
  responseKey: key,
  filename: 'Habun-Test.pdf',
  contentType: 'application/pdf',
})

assert.equal(encrypted.version, 1)
assert.equal(encrypted.algorithm, 'A256GCM')
assert.equal(encrypted.filename, 'Habun-Test.pdf')
assert.equal(encrypted.contentType, 'application/pdf')
assert.ok(encrypted.iv)
assert.ok(encrypted.tag)
assert.ok(encrypted.ciphertext)
assert.equal(new TextDecoder().decode(decryptPortalAdminExportForTest(encrypted, key)), 'habun-report-test')
assert.throws(() => decryptPortalAdminExportForTest(encrypted, randomBytes(32).toString('base64')))

console.log('portal admin export envelope tests passed')
