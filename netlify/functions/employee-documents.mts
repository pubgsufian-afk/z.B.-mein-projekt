import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getDatabase } from '@netlify/database'
import { verifyRequestOrigin } from '@netlify/identity'
import { createHash, randomUUID } from 'node:crypto'
import { requirePortalRole } from './_shared/portal-role.mts'
import { sendPushToUsers } from './_shared/push-core.mts'
import { mayManageEmployeeDocuments, mayDownloadEmployeeDocument, mayPublishToRecipient } from './_shared/employee-self-service-policy.mjs'

const TYPES = new Set(['contract', 'payslip', 'other'])
const MAX_BYTES = 4 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function store(context: Context) {
  // Never let deploy previews read or write the production personnel file store.
  const name = context.deploy?.context === 'production'
    ? 'habun-employee-documents'
    : 'habun-employee-documents-preview'
  return getStore({ name, region: 'eu-central-1', consistency: 'strong' })
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  } })
}
function clean(value: unknown, max = 180) {
  return String(value || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, max)
}
function publicRow(row: Record<string, unknown>, senders: Map<string, string>) {
  return {
    id: row.id,
    employeeUserId: row.employee_user_id,
    // Never trust a sender name supplied by the uploading browser.
    // Resolve sender_user_id using authenticated company records instead.
    senderName: senders.get(String(row.sender_user_id || '')) || 'Absender nicht zugeordnet',
    documentType: row.document_type,
    title: row.title,
    fileName: row.file_name,
    byteSize: row.byte_size,
    publishedAt: row.published_at,
    firstOpenedAt: row.first_opened_at,
    revokedAt: row.revoked_at,
  }
}
// The sender's immutable account ID has been stored since the mailbox was created.
// Resolve names server-side for both existing and future documents, without exposing
// account IDs, email addresses or the complete employee directory to recipients.
async function senderNamesFor(
  rows: Record<string, unknown>[],
  db: ReturnType<typeof getDatabase>,
  actor: { userId: string; user: unknown },
) {
  const ids = [...new Set(rows.map((row) => clean(row.sender_user_id, 160)).filter(Boolean))]
  const names = new Map<string, string>()
  if (!ids.length) return names

  const accessStore = getStore({ name: 'portal-access', consistency: 'strong' })
  await Promise.all(ids.map(async (id) => {
    try {
      const account = await accessStore.get('access/' + id, { type: 'json' }) as { fullName?: unknown } | null
      const name = clean(account?.fullName, 120)
      if (name) names.set(id, name)
    } catch {
      // Sender identity lookup must not prevent employees from opening documents.
    }
  }))

  const unknown = ids.filter((id) => !names.has(id))
  if (unknown.length) {
    try {
      const listed = await db.pool.query(
        'SELECT user_id, full_name FROM schedule_employees WHERE user_id = ANY($1::text[])',
        [unknown],
      )
      for (const row of listed.rows) {
        const id = clean(row.user_id, 160)
        const name = clean(row.full_name, 120)
        if (id && name && unknown.includes(id)) names.set(id, name)
      }
    } catch {
      // Old or unsynced personnel records may not exist on every database branch.
    }
  }

  // Owners may be approved by email without a portal-access record. If the
  // current authenticated owner uploaded the document, their identity metadata
  // is an additional trustworthy source for their *own* name.
  if (ids.includes(actor.userId) && !names.has(actor.userId)) {
    const user = actor.user && typeof actor.user === 'object'
      ? actor.user as Record<string, unknown>
      : {}
    const metadata = user.userMetadata && typeof user.userMetadata === 'object'
      ? user.userMetadata as Record<string, unknown>
      : user.user_metadata && typeof user.user_metadata === 'object'
        ? user.user_metadata as Record<string, unknown>
        : {}
    const ownName = clean(metadata.fullName || metadata.full_name || metadata.name || user.name, 120)
    if (ownName) names.set(actor.userId, ownName)
  }
  return names
}

function pdfFilename(value: unknown) {
  const safe = clean(value, 120).replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/[\/\\]/g, '_')
  const base = safe.replace(/\.pdf$/i, '') || 'Dokument'
  return base + '.pdf'
}
async function audit(documentId: string, actorId: string, action: 'upload' | 'download' | 'revoke') {
  const db = getDatabase()
  await db.pool.query(
    'INSERT INTO employee_document_access_audit (id, document_id, actor_user_id, action) VALUES ($1, $2, $3, $4)',
    [randomUUID(), documentId, actorId, action],
  )
}

export default async function employeeDocuments(request: Request, context: Context) {
  const access = await requirePortalRole(['owner', 'admin', 'manager', 'employee'])
  if (access.response || !access.current) return access.response
  const actor = access.current
  const isAdmin = mayManageEmployeeDocuments(actor.role)
  const url = new URL(request.url)

  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return json({ message: 'Methode nicht erlaubt.' }, 405)
  }
  try {
    if (request.method === 'GET' && url.searchParams.get('action') === 'download') {
      const id = clean(url.searchParams.get('id'), 40)
      if (!UUID.test(id)) return json({ message: 'Dokument nicht gefunden.' }, 404)
      const db = getDatabase()
      const result = await db.pool.query('SELECT * FROM employee_documents WHERE id = $1 LIMIT 1', [id])
      const row = result.rows[0]
      if (!mayDownloadEmployeeDocument(actor, row)) {
        return json({ message: 'Dokument nicht gefunden.' }, 404)
      }
      const bytes = await store(context).get(String(row.blob_key), { type: 'arrayBuffer' })
      if (bytes === null) return json({ message: 'Die Datei ist nicht mehr verfügbar.' }, 404)
      const buffer = Buffer.from(bytes)
      if (createHash('sha256').update(buffer).digest('hex') !== row.sha256) {
        console.error('Employee document integrity mismatch', { documentId: id })
        return json({ message: 'Die Datei konnte nicht sicher überprüft werden.' }, 500)
      }
      if (!isAdmin) {
        await db.pool.query(
          'UPDATE employee_documents SET first_opened_at = COALESCE(first_opened_at, now()) WHERE id = $1',
          [id],
        )
      }
      await audit(id, actor.userId, 'download')
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="' + pdfFilename(row.file_name) + '"',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': 'sandbox',
          'X-Robots-Tag': 'noindex',
        },
      })
    }

    if (request.method === 'GET') {
      // Employees (including managers) always see ONLY their own mailbox.
      const filterId = isAdmin ? clean(url.searchParams.get('employeeUserId'), 160) : actor.userId
      const db = getDatabase()
      const result = filterId
        ? await db.pool.query(
            'SELECT * FROM employee_documents WHERE employee_user_id = $1 ORDER BY published_at DESC, id DESC LIMIT 200',
            [filterId],
          )
        : await db.pool.query('SELECT * FROM employee_documents ORDER BY published_at DESC, id DESC LIMIT 200')
      const visibleRows = result.rows.filter((row) => isAdmin || !row.revoked_at)
      const senderNames = await senderNamesFor(visibleRows, db, actor)
      const documents = visibleRows.map((row) => publicRow(row, senderNames))
      const unreadCount = documents.filter((row) => !row.revokedAt && !row.firstOpenedAt).length
      return json({ documents, unreadCount })
    }

    if (!isAdmin) return json({ message: 'Nur die Verwaltung darf Dokumente versenden oder zurückziehen.' }, 403)
    try { verifyRequestOrigin(request) } catch {
      return json({ message: 'Ungültige Anfragequelle.' }, 403)
    }
    const db = getDatabase()
    if (request.method === 'DELETE') {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null
      const id = clean(body?.id, 40)
      if (!UUID.test(id)) return json({ message: 'Dokument nicht gefunden.' }, 404)
      const result = await db.pool.query(
        'UPDATE employee_documents SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id',
        [id, actor.userId],
      )
      if (!result.rows.length) return json({ message: 'Dokument nicht gefunden oder bereits zurückgezogen.' }, 404)
      await audit(id, actor.userId, 'revoke')
      return json({ ok: true })
    }

    const type = String(request.headers.get('content-type') || '').toLowerCase()
    if (!type.includes('multipart/form-data')) return json({ message: 'Ungültiges Upload-Format.' }, 415)
    const form = await request.formData()
    const employeeUserId = clean(form.get('employeeUserId'), 160)
    const documentType = clean(form.get('documentType'), 20)
    // Standarddokumente werden serverseitig benannt; nur Sonstiges benötigt einen eigenen Titel.
    const title = documentType === 'contract' ? 'Arbeitsvertrag'
      : documentType === 'payslip' ? 'Lohnabrechnung'
      : clean(form.get('title'), 180)
    const file = form.get('file')
    if (!employeeUserId || !TYPES.has(documentType) || !title) {
      return json({ message: 'Mitarbeiter, Dokumentart und Titel sind erforderlich.' }, 400)
    }
    if (typeof file !== 'object' || !file || !('arrayBuffer' in file) || !('size' in file)) {
      return json({ message: 'Bitte eine PDF-Datei auswählen.' }, 400)
    }
    const pdf = file as File
    if (pdf.size < 5 || pdf.size > MAX_BYTES) return json({ message: 'Die PDF darf höchstens 4 MB groß sein.' }, 413)
    const bytes = Buffer.from(await pdf.arrayBuffer())
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return json({ message: 'Die Datei ist keine gültige PDF-Datei.' }, 415)
    }

    // Reject inactive/unapproved accounts and stale duplicate registrations.
    const recipient = await getStore({ name: 'portal-access', consistency: 'strong' })
      .get('access/' + employeeUserId, { type: 'json' }) as { status?: string; role?: string } | null
    if (!mayPublishToRecipient(actor.role, recipient)) {
      return json({ message: 'Empfänger ist nicht als aktives Mitarbeiterkonto freigeschaltet.' }, 409)
    }

    const id = randomUUID()
    const key = 'docs/' + id
    const fileName = pdfFilename(pdf.name)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await store(context).set(key, pdf)
    try {
      const inserted = await db.pool.query(
        `INSERT INTO employee_documents
           (id, employee_user_id, sender_user_id, document_type, title, file_name, blob_key, sha256, byte_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [id, employeeUserId, actor.userId, documentType, title, fileName, key, sha256, bytes.length],
      )
      await audit(id, actor.userId, 'upload')
      // Only the authenticated, selected recipient gets a notification. Never expose
      // document type, title, PDF name or payroll data in a push message.
      try {
        await sendPushToUsers({
          userIds: [employeeUserId],
          title: 'HABUN Mitarbeiterportal',
          body: 'Du hast ein neues Dokument in deinem Postfach.',
          url: '/?view=mailbox',
        })
      } catch (pushError) {
        // A temporary push failure must never undo an already published document.
        console.error('Employee mailbox push failed', pushError)
      }
      const senderNames = await senderNamesFor(inserted.rows, db, actor)
      return json({ document: publicRow(inserted.rows[0], senderNames) }, 201)
    } catch (error) {
      // Do not retain a free-floating confidential file without DB metadata.
      // If metadata was inserted but only audit failed, keep the file rather
      // than breaking a link to an already-published document.
      const existing = await db.pool.query('SELECT id FROM employee_documents WHERE id = $1', [id]).catch(() => ({ rows: [] }))
      if (!existing.rows.length) await store(context).delete(key).catch(() => {})
      throw error
    }
  } catch (error) {
    console.error('Employee documents operation failed', {
      method: request.method,
      error,
    })
    return json({ message: 'Das Mitarbeiterpostfach ist momentan nicht verfügbar.' }, 500)
  }
}

export const config: Config = { path: '/api/employee-documents' }
