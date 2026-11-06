import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'

// Minimal, read-only readiness probe for isolated preview builds.
// No table rows, usernames, filenames, record counts or secrets are returned.
// Must never answer database questions on the production site.
export default async function employeeDocumentDatabaseHealth(request: Request, context: Context) {
  if (context.deploy?.context !== 'deploy-preview') {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const db = getDatabase()
    const result = await db.pool.query(
      `SELECT
        to_regclass('public.employee_documents') IS NOT NULL AS documents_ready,
        to_regclass('public.employee_document_access_audit') IS NOT NULL AS audit_ready`,
    )
    const ready = result.rows[0]?.documents_ready === true && result.rows[0]?.audit_ready === true
    return Response.json({ ready }, {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch {
    return Response.json({ ready: false }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' },
    })
  }
}

export const config: Config = { path: '/api/employee-document-database-health' }
