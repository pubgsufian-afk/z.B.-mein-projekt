import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'

// Read-only preview readiness probe. Production deliberately returns 404.
// No employee names, records, PDFs or database connection details are exposed.
export default async function largeInboxHealth(request: Request, context: Context) {
  if (context.deploy?.context !== 'deploy-preview') {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const db = getDatabase()
    const result = await db.pool.query(
      "SELECT EXISTS (" +
      " SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.employee_documents')" +
      " AND contype = 'c' AND conname = 'employee_documents_byte_size_check'" +
      " AND pg_get_constraintdef(oid) LIKE '%52428800%'" +
      ") AS ready",
    )
    const ready = result.rows[0]?.ready === true
    return Response.json({ ready }, {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff' },
    })
  } catch {
    return Response.json({ ready: false }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff' },
    })
  }
}
export const config: Config = { path: '/api/employee-document-large-database-health' }
