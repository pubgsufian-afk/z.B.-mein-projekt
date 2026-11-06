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
  '@netlify/blobs': String.raw