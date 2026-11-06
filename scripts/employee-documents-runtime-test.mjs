import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Backend integration test: the real API module and permission checks run
// against fake Netlify identity, blobs and SQL. Never touches real personnel data.
const state = { actor: null, access: {}, documents: [], blobs: new Map(), audit: [] }
globalThis.__habunMailboxTest = state
globalThis.Netlify = { env: { get: () => '' } }

state.access['access/admin-1'] = { role: 'admin', status: 'active' }
state.access['access/employee-a'] = { role: 'employee', status: 'active' }
state.access['access/employee-b'] = { role: 'employee', status: 'active' }
state.access['access/manager-1'] = { role: 'manager', status: 'active' }
state.access['access/pending-1'] = { role: 'pending', status: 'pending' }
state.access['access/inactive-1'] = { role: 'employee', status: 'inactive' }

function query(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalized.startsWith('insert into employee_document_access_audit')) {
    const [id, documentId, actorId, action] = params
    state.audit.push({ id, documentId, actorId, action })
    return { rows: [] }
  }
  if (normalized.startsWith('insert into employee_documents')) {
    const [id, employeeUserId, senderUserId, documentType, title, fileName, blobKey, sha256, byteSize] = params
    const row = {
      id, employee_user_id: employeeUserId, sender_user_id: senderUserId,
      document_type: documentType, title, file_name: fileName,
      blob_key: blobKey, sha256, byte_size: byteSize,
      published_at: new Date().toISOString(),
      first_opened_at: null, revoked_at: null, revoked_by: null,
    }
    state.documents.push(row)
    return { rows: [row] }
  }
  if (normalized.startsWith('select * from employee_documents where id =')) {
    return { rows: state.documents.filter((item) => item.id === params[0]) }
  }
  if (normalized.startsWith('select * from employee_documents where employee_user_id =')) {
    return { rows: state.documents.filter((item) => item.employee_user_id === params[0]) }
  }
  if (normalized.startsWith('select * from employee_documents order by')) {
    return { rows: [...state.documents] }
  }
  if (normalized.startsWith('update employee_documents set first_opened_at')) {
    const item = state.documents.find((entry) => entry.id === params[0])
    if (item) item.first_opened_at ||= new Date().toISOString()
    return { rows: [] }
  }
  if (normalized.startsWith('update employee_documents set revoked_at')) {
    const item = state.documents.find((entry) => entry.id === params[0] && !entry.revoked_at)
    if (item) {
      item.revoked_at = new Date().toISOString()
      item.revoked_by = params[1]
    }
    return { rows: item ? [{ id: item.id }] : [] }
  }
  if (normalized.startsWith('select id from employee_documents where id =')) {
    return { rows: state.documents.filter((entry) => entry.id === params[0]).map((entry) => ({ id: entry.id })) }
  }
  throw Error('Unhandled test SQL: ' + sql)
}
state.query = query

const mocks = {
  '@netlify/identity': "export async function getUser() { return globalThis.__habunMailboxTest.actor } export function verifyRequestOrigin(request) { if (request.headers.get('x-test-invalid-origin')) throw Error('Invalid origin') }",
  '@netlify/database': "export function getDatabase() { return { pool: { query: (sql, params) => globalThis.__habunMailboxTest.query(sql, params) } } }",
  '@netlify/blobs': [
    "export function getStore({ name }) {",
    "  const state = globalThis.__habunMailboxTest",
    "  if (name === 'portal-access') return { get: async (key) => state.access[key] ?? null }",
    "  if (!state.blobs.has(name)) state.blobs.set(name, new Map())",
    "  const files = state.blobs.get(name)",
    "  return {",
    "    get: async (key) => files.has(key) ? await files.get(key).arrayBuffer() : null,",
    "    set: async (key, file) => { files.set(key, file) },",
    "    delete: async (key) => { files.delete(key) },",
    "  }",
    "}",
  ].join('\n'),
}
const bundled = await build({
  entryPoints: ['netlify/functions/employee-documents.mts'],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{
    name: 'fake-netlify-runtime',
    setup(context) {
      context.onResolve({ filter: /^@netlify\/(identity|database|blobs)$/ }, (args) => ({ path: args.path, namespace: 'mailbox-mock' }))
      context.onLoad({ filter: /.*/, namespace: 'mailbox-mock' }, (args) => ({ contents: mocks[args.path], loader: 'js' }))
    },
  }],
})
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

const actors = {
  admin: { id: 'admin-1', email: 'admin@example.test' },
  a: { id: 'employee-a', email: 'a@example.test' },
  b: { id: 'employee-b', email: 'b@example.test' },
  manager: { id: 'manager-1', email: 'manager@example.test' },
  pending: { id: 'pending-1', email: 'pending@example.test' },
}
function selectActor(key) { state.actor = key ? actors[key] : null }
const base = 'https://example.test/api/employee-documents'
function request(url = base, method = 'GET', data) {
  const init = { method }
  if (data !== undefined) {
    if (data instanceof FormData) init.body = data
    else { init.body = JSON.stringify(data); init.headers = { 'content-type': 'application/json' } }
  }
  return new Request(url, init)
}
async function call(url = base, method = 'GET', data) {
  return handler(request(url, method, data), { deploy: { context: 'deploy-preview' } })
}
function upload(recipient, contents = '%PDF-1.7\nTest content, no personal data') {
  const body = new FormData()
  body.set('employeeUserId', recipient)
  body.set('documentType', 'payslip')
  body.set('title', 'Testabrechnung')
  body.set('file', new File([contents], 'abrechnung.pdf', { type: 'application/pdf' }))
  return body
}

selectActor(null)
assert.equal((await call()).status, 401, 'Anonymous user must be denied')
selectActor('pending')
assert.equal((await call()).status, 403, 'Pending account must be denied')
selectActor('a')
assert.equal((await call(base, 'POST', upload('employee-a'))).status, 403, 'Employees cannot publish')
selectActor('manager')
assert.equal((await call(base, 'POST', upload('employee-a'))).status, 403, 'Managers cannot publish')

selectActor('admin')
assert.equal((await call(base, 'POST', upload('inactive-1'))).status, 409, 'Inactive recipient blocked')
assert.equal((await call(base, 'POST', upload('pending-1'))).status, 409, 'Pending recipient blocked')
assert.equal((await call(base, 'POST', upload('employee-a', 'NOT-A-PDF'))).status, 415, 'Non-PDF blocked')
const tooLarge = '%PDF-' + 'A'.repeat(4 * 1024 * 1024)
assert.equal((await call(base, 'POST', upload('employee-a', tooLarge))).status, 413, 'Oversize PDF blocked')
const responseA = await call(base, 'POST', upload('employee-a'))
const responseB = await call(base, 'POST', upload('employee-b'))
assert.equal(responseA.status, 201)
assert.equal(responseB.status, 201)
const documentA = (await responseA.json()).document
const documentB = (await responseB.json()).document
assert.ok(documentA.id && documentB.id && documentA.id !== documentB.id)
assert.equal(state.audit.filter((item) => item.action === 'upload').length, 2)

selectActor('a')
const listingA = await (await call()).json()
assert.equal(listingA.documents.length, 1, 'Employee sees exactly one own document')
assert.equal(listingA.documents[0].id, documentA.id)
assert.equal((await call(base + '?action=download&id=' + documentB.id)).status, 404, 'Cross-employee download blocked')
const ownPdf = await call(base + '?action=download&id=' + documentA.id)
assert.equal(ownPdf.status, 200)
assert.match(ownPdf.headers.get('content-type'), /application\/pdf/)
assert.ok((await ownPdf.text()).startsWith('%PDF-'))
assert.equal((await call(base, 'DELETE', { id: documentA.id })).status, 403, 'Employee cannot withdraw PDF')

selectActor('b')
const listingB = await (await call()).json()
assert.deepEqual(listingB.documents.map((item) => item.id), [documentB.id])
assert.equal((await call(base + '?action=download&id=' + documentA.id)).status, 404)

selectActor('admin')
assert.equal((await call(base, 'DELETE', { id: documentA.id })).status, 200)
assert.equal((await call(base, 'DELETE', { id: documentA.id })).status, 404, 'Withdrawal is one-time')
selectActor('a')
assert.equal((await call(base + '?action=download&id=' + documentA.id)).status, 404, 'Revoked PDF inaccessible')
assert.equal((await (await call()).json()).documents.length, 0, 'Revoked PDF hidden')
assert.equal(state.audit.filter((entry) => entry.action === 'revoke').length, 1)

console.log('PASS: actual mailbox API handler: anonymous/pending isolation, admin-only sending, PDF validation, separate staff inboxes, download, audit, revocation and forbidden cross-account access')
