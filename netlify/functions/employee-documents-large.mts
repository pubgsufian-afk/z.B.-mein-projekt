import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getDatabase } from '@netlify/database'
import { verifyRequestOrigin } from '@netlify/identity'
import { createHash, randomUUID } from 'node:crypto'
import { requirePortalRole } from './_shared/portal-role.mts'
import { mayManageEmployeeDocuments, mayDownloadEmployeeDocument, mayPublishToRecipient } from './_shared/employee-self-service-policy.mjs'
import { sendPushToUsers } from './_shared/push-core.mts'

// Netlify's buffered function requests cap binary payloads at ~4.5 MiB.
// Chunks are kept well below that ceiling for both upload and download.
const CHUNK_BYTES = 2 * 1024 * 1024
const MAX_BYTES = 50 * 1024 * 1024
const MAX_CHUNKS = MAX_BYTES / CHUNK_BYTES
const SESSION_MS = 2 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES = new Set(['contract', 'payslip', 'other'])
type UploadSession = {
  id: string
  senderUserId: string
  employeeUserId: string
  documentType: string
  title: string
  fileName: string
  byteSize: number
  chunkCount: number
  expiresAt: number
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  } })
}
function name(value: unknown, max = 180) {
  return String(value || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, max)
}
function pdfFilename(value: unknown) {
  const safe = name(value, 120).replace(/[^a-zA-Z0-9._ -]/g, '_')
  return (safe.replace(/\.pdf$/i, '') || 'Dokument') + '.pdf'
}
function privateStore(context: Context, staging = false) {
  const suffix = context.deploy?.context === 'production' ? '' : '-preview'
  const storeName = staging ? 'habun-employee-documents-staging' : 'habun-employee-documents'
  return getStore({ name: storeName + suffix, region: 'eu-central-1', consistency: 'strong' })
}
function chunkKey(id: string, index: number) {
  return 'chunks/' + id + '/' + index
}
function partKey(id: string, index: number) {
  return 'v2/' + id + '/part/' + index
}
function manifestKey(id: string) {
  return 'v2/' + id + '/manifest'
}
function chunkCount(size: number) {
  return Math.ceil(size / CHUNK_BYTES)
}
async function loadSession(context: Context, id: string, userId: string): Promise<UploadSession | null> {
  if (!UUID.test(id)) return null
  const info = await privateStore(context, true).get('sessions/' + id, { type: 'json' }) as UploadSession | null
  if (!info || info.id !== id || info.senderUserId !== userId || info.expiresAt <= Date.now()) return null
  if (!Number.isSafeInteger(info.byteSize) || info.byteSize < 5 || info.byteSize > MAX_BYTES) return null
  if (info.chunkCount !== chunkCount(info.byteSize) || info.chunkCount > MAX_CHUNKS) return null
  return info
}
async function deleteSession(context: Context, session: UploadSession) {
  const stage = privateStore(context, true)
  const keys = Array.from({ length: session.chunkCount }, (_, i) => chunkKey(session.id, i))
  for (let start = 0; start < keys.length; start += 6) {
    await Promise.allSettled(keys.slice(start, start + 6).map((key) => stage.delete(key)))
  }
  await stage.delete('sessions/' + session.id)
}
async function removeExpiredSessions(context: Context) {
  // Netlify Blobs does not expire files automatically. Reclaim up to two
  // expired staging sessions when an administrator starts a new upload.
  try {
    const stage = privateStore(context, true)
    const { blobs } = await stage.list({ prefix: 'sessions/' })
    let cleaned = 0
    for (const entry of blobs) {
      if (cleaned >= 2) break
      const session = await stage.get(entry.key, { type: 'json' }) as UploadSession | null
      if (!session || session.expiresAt <= Date.now()) {
        if (session?.id && UUID.test(session.id) && session.chunkCount <= MAX_CHUNKS) {
          await deleteSession(context, session)
        } else await stage.delete(entry.key)
        cleaned++
      }
    }
  } catch (error) {
    console.warn('Could not collect stale document upload session', error)
  }
}
async function activeRecipient(actorRole: string, id: string) {
  const user = await getStore({ name: 'portal-access', consistency: 'strong' })
    .get('access/' + id, { type: 'json' }) as { role?: string; status?: string } | null
  return mayPublishToRecipient(actorRole, user)
}
async function findAuthorizedDocument(id: string, actor: { userId: string; role: string }) {
  if (!UUID.test(id)) return null
  const db = getDatabase()
  const result = await db.pool.query('SELECT * FROM employee_documents WHERE id = $1 LIMIT 1', [id])
  const row = result.rows[0]
  if (!mayDownloadEmployeeDocument(actor, row) || row.blob_key !== manifestKey(id)) return null
  return row
}
async function storedManifest(context: Context, row: Record<string, unknown>) {
  const id = String(row.id)
  const data = await privateStore(context).get(manifestKey(id), { type: 'json' }) as
    { version?: number; chunkCount?: number; sha256?: string; byteSize?: number } | null
  if (!data || data.version !== 2 || data.chunkCount !== chunkCount(Number(row.byte_size))
    || data.sha256 !== row.sha256 || data.byteSize !== Number(row.byte_size)
    || data.chunkCount > MAX_CHUNKS) {
    return null
  }
  return data
}

export default async function employeeLargeDocuments(request: Request, context: Context) {
  const access = await requirePortalRole(['owner', 'admin', 'manager', 'employee'])
  if (access.response || !access.current) return access.response
  const actor = access.current
  const isAdmin = mayManageEmployeeDocuments(actor.role)
  const url = new URL(request.url)
  const action = url.searchParams.get('action') || ''
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    // Every read must re-check the recipient, including each individual chunk.
    if (request.method === 'GET') {
      if (action !== 'info' && action !== 'part') return json({ message: 'Unbekannte Anfrage.' }, 400)
      const id = name(url.searchParams.get('id'), 40)
      const row = await findAuthorizedDocument(id, actor)
      if (!row) return json({ message: 'Dokument nicht gefunden.' }, 404)
      const manifest = await storedManifest(context, row)
      if (!manifest) return json({ message: 'Dokument konnte nicht überprüft werden.' }, 500)
      if (action === 'info') {
        return json({
          fileName: pdfFilename(row.file_name),
          byteSize: manifest.byteSize,
          sha256: manifest.sha256,
          chunkCount: manifest.chunkCount,
          chunkSize: CHUNK_BYTES,
        })
      }
      const rawIndex = url.searchParams.get('index') || ''
      if (!/^(0|[1-9]\d?)$/.test(rawIndex)) return json({ message: 'Ungültiger Dateiteil.' }, 400)
      const index = Number(rawIndex)
      if (index >= manifest.chunkCount) return json({ message: 'Dateiteil nicht gefunden.' }, 404)
      const data = await privateStore(context).get(partKey(id, index), { type: 'arrayBuffer' })
      if (!data) return json({ message: 'Dateiteil ist nicht verfügbar.' }, 404)
      const expected = Math.min(CHUNK_BYTES, manifest.byteSize - index * CHUNK_BYTES)
      if (data.byteLength !== expected) return json({ message: 'Beschädigter Dateiteil.' }, 500)
      // Record the download only when its final part is requested; admin reads
      // must not alter the employee's unread marker.
      if (index === manifest.chunkCount - 1) {
        const db = getDatabase()
        if (!isAdmin) {
          await db.pool.query(
            'UPDATE employee_documents SET first_opened_at = COALESCE(first_opened_at, now()) WHERE id = $1',
            [id],
          )
        }
        await db.pool.query(
          'INSERT INTO employee_document_access_audit (id, document_id, actor_user_id, action) VALUES ($1, $2, $3, $4)',
          [randomUUID(), id, actor.userId, 'download'],
        )
      }
      return new Response(data, { status: 200, headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        'X-Robots-Tag': 'noindex',
      } })
    }

    if (!isAdmin) return json({ message: 'Nur die Verwaltung darf PDF-Dateien zustellen.' }, 403)
    try { verifyRequestOrigin(request) } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403) }
    const db = getDatabase()

    if (action === 'begin') {
      const input = await request.json().catch(() => null) as Record<string, unknown> | null
      const employeeUserId = name(input?.employeeUserId, 160)
      const documentType = name(input?.documentType, 20)
      const title = documentType === 'contract' ? 'Arbeitsvertrag'
        : documentType === 'payslip' ? 'Lohnabrechnung'
        : name(input?.title, 180)
      const byteSize = Number(input?.byteSize)
      const fileName = pdfFilename(input?.fileName)
      if (!employeeUserId || !TYPES.has(documentType) || !title || !Number.isSafeInteger(byteSize)
        || byteSize < 5 || byteSize > MAX_BYTES || !/\.pdf$/i.test(name(input?.fileName, 160))) {
        return json({ message: 'Bitte gültigen Empfänger, Dokumentart und PDF bis 50 MB auswählen.' }, 400)
      }
      if (!(await activeRecipient(actor.role, employeeUserId))) {
        return json({ message: 'Empfänger ist nicht als aktives Mitarbeiterkonto freigeschaltet.' }, 409)
      }
      const id = randomUUID()
      const session: UploadSession = {
        id, senderUserId: actor.userId, employeeUserId, documentType, title, fileName,
        byteSize, chunkCount: chunkCount(byteSize), expiresAt: Date.now() + SESSION_MS,
      }
      await privateStore(context, true).setJSON('sessions/' + id, session)
      // Best effort; does not block a legitimate upload if cleanup is unavailable.
      await removeExpiredSessions(context)
      return json({ uploadId: id, chunkSize: CHUNK_BYTES, chunkCount: session.chunkCount }, 201)
    }

    const id = name(url.searchParams.get('id'), 40)
    const session = await loadSession(context, id, actor.userId)
    if (!session) {
      if (action === 'finish' && UUID.test(id)) {
        const found = await db.pool.query(
          'SELECT id FROM employee_documents WHERE id = $1 AND sender_user_id = $2 LIMIT 1',
          [id, actor.userId],
        )
        if (found.rows.length) return json({ id, alreadyPublished: true })
      }
      return json({ message: 'Upload-Sitzung abgelaufen oder nicht gefunden. Bitte neu beginnen.' }, 410)
    }

    if (action === 'cancel') {
      await deleteSession(context, session)
      return json({ ok: true })
    }

    if (action === 'chunk') {
      if (!String(request.headers.get('content-type') || '').startsWith('application/octet-stream')) {
        return json({ message: 'Ungültiger Dateiteil.' }, 415)
      }
      const rawIndex = url.searchParams.get('index') || ''
      if (!/^(0|[1-9]\d?)$/.test(rawIndex)) return json({ message: 'Ungültiger Dateiteil.' }, 400)
      const index = Number(rawIndex)
      if (index >= session.chunkCount) return json({ message: 'Ungültiger Dateiteil.' }, 400)
      const declared = Number(request.headers.get('content-length') || 0)
      const expected = Math.min(CHUNK_BYTES, session.byteSize - index * CHUNK_BYTES)
      if (declared && declared !== expected) return json({ message: 'Falsche Dateiteilgröße.' }, 400)
      const data = await request.arrayBuffer()
      if (data.byteLength !== expected) return json({ message: 'Falsche Dateiteilgröße.' }, 400)
      const bytes = new Uint8Array(data)
      if (index === 0 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
        return json({ message: 'Die Datei ist keine gültige PDF-Datei.' }, 415)
      }
      await privateStore(context, true).set(chunkKey(id, index), bytes)
      return json({ ok: true, index })
    }

    if (action !== 'finish') return json({ message: 'Unbekannte Aktion.' }, 400)
    if (!(await activeRecipient(actor.role, session.employeeUserId))) {
      return json({ message: 'Empfängerkonto ist nicht mehr aktiv.' }, 409)
    }
    const staging = privateStore(context, true)
    const documents = privateStore(context)
    const sha = createHash('sha256')
    const parts: Uint8Array[] = []
    let total = 0
    for (let i = 0; i < session.chunkCount; i++) {
      const part = await staging.get(chunkKey(id, i), { type: 'arrayBuffer' })
      if (!part) return json({ message: 'Ein PDF-Dateiteil fehlt. Bitte Upload erneut versuchen.' }, 409)
      const expected = Math.min(CHUNK_BYTES, session.byteSize - i * CHUNK_BYTES)
      if (part.byteLength !== expected) return json({ message: 'Ein PDF-Dateiteil ist beschädigt.' }, 409)
      const chunk = new Uint8Array(part)
      if (i === 0 && Buffer.from(chunk.subarray(0, 5)).toString('ascii') !== '%PDF-') {
        return json({ message: 'Die Datei ist keine gültige PDF-Datei.' }, 415)
      }
      sha.update(chunk)
      total += chunk.byteLength
      parts.push(chunk)
    }
    if (total !== session.byteSize) return json({ message: 'Die Dateigröße stimmt nicht überein.' }, 409)
    const digest = sha.digest('hex')

    // Persist private chunks and manifest before publishing the SQL document.
    // A single document_id is used for both the upload session and DB primary key.
    // This keeps retries idempotent and prevents duplicate recipient push messages.
    try {
      for (let i = 0; i < parts.length; i += 4) {
        await Promise.all(parts.slice(i, i + 4).map((chunk, offset) =>
          documents.set(partKey(id, i + offset), chunk)))
      }
      await documents.setJSON(manifestKey(id), {
        version: 2, byteSize: total, sha256: digest, chunkCount: parts.length,
      })
    } catch (error) {
      console.error('Employee document chunk storage failed', error)
      return json({ message: 'PDF konnte nicht sicher gespeichert werden. Bitte erneut versuchen.' }, 500)
    }

    let inserted: Record<string, unknown> | undefined
    try {
      const result = await db.pool.query(
        'INSERT INTO employee_documents ' +
        '(id, employee_user_id, sender_user_id, document_type, title, file_name, blob_key, sha256, byte_size) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING *',
        [id, session.employeeUserId, actor.userId, session.documentType, session.title,
          session.fileName, manifestKey(id), digest, total],
      )
      inserted = result.rows[0]
    } catch (error) {
      // A missing 50 MB database migration must never publish a damaged record.
      // Keep the upload session for a retry; fail clearly instead of claiming success.
      console.error('Employee document database publish failed', error)
      return json({ message: 'Der große PDF-Upload konnte nicht abgeschlossen werden. Bitte die Verwaltung kontaktieren.' }, 500)
    }

    if (inserted) {
      try {
        await db.pool.query(
          'INSERT INTO employee_document_access_audit (id, document_id, actor_user_id, action) VALUES ($1, $2, $3, $4)',
          [randomUUID(), id, actor.userId, 'upload'],
        )
      } catch (error) { console.error('Document upload audit failed', error) }
      try {
        await sendPushToUsers({
          userIds: [session.employeeUserId],
          title: 'HABUN Mitarbeiterportal',
          body: 'Du hast ein neues Dokument in deinem Postfach.',
          url: '/?view=mailbox',
        })
      } catch (error) { console.error('Employee mailbox push failed', error) }
    }
    try { await deleteSession(context, session) }
    catch (error) { console.warn('Completed upload staging cleanup failed', error) }
    return json({ id, alreadyPublished: !inserted }, inserted ? 201 : 200)
  } catch (error) {
    console.error('Large employee document action failed', { action, error })
    return json({ message: 'Das Postfach ist momentan nicht erreichbar. Bitte erneut versuchen.' }, 500)
  }
}

export const config: Config = { path: '/api/employee-documents-large' }
