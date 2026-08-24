import { databaseConnectionString } from './database-connection.mts'

export type AttendanceMaintenanceAdminActor = {
  userId: string
  email: string
  role: 'owner' | 'admin' | 'manager'
}

type SqlClient = { query(text: string, params?: unknown[]): Promise<any[]> }

export class AttendanceMaintenanceAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'ATTENDANCE_MAINTENANCE_ERROR') {
    super(message)
    this.name = 'AttendanceMaintenanceAdminError'
    this.status = status
    this.code = code
  }
}

function clean(value: unknown, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

async function connection(): Promise<SqlClient> {
  const url = databaseConnectionString()
  if (!url) throw new AttendanceMaintenanceAdminError('Die Zeiterfassungsdatenbank ist noch nicht verbunden.', 503, 'DATABASE_UNAVAILABLE')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url) as unknown as SqlClient
}

function cleanRequestedData(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const cleanData: Record<string, unknown> = {}
  for (const key of ['clockInAt', 'clockOutAt'] as const) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue
    const date = new Date(String(source[key]))
    if (!Number.isFinite(date.getTime())) throw new AttendanceMaintenanceAdminError(`${key} ist kein gültiger Zeitpunkt.`, 400, 'INVALID_TIME')
    cleanData[key] = date.toISOString()
  }
  if (source.pauseMinutes !== undefined && source.pauseMinutes !== null && source.pauseMinutes !== '') {
    const pause = Number(source.pauseMinutes)
    if (!Number.isFinite(pause) || pause < 0 || !Number.isInteger(pause)) {
      throw new AttendanceMaintenanceAdminError('Die Pause muss eine nichtnegative ganze Minute sein.', 400, 'INVALID_PAUSE')
    }
    cleanData.pauseMinutes = pause
  }
  if (source.note !== undefined && source.note !== null) {
    const note = clean(source.note, 1000)
    if (note) cleanData.note = note
  }
  return cleanData
}

export function createAttendanceMaintenanceAdminService() {
  return {
    async listCorrections() {
      const sql = await connection()
      return await sql.query(
        `SELECT c.id, c.event_id, c.requested_by, c.reason, c.before_data, c.after_data,
                c.occurred_at, c.expires_at,
                d.decision, d.reason AS decision_reason, d.after_data AS decision_after_data,
                d.occurred_at AS decided_at, d.actor_role AS decided_by_role
           FROM attendance_corrections c
           LEFT JOIN LATERAL (
             SELECT * FROM attendance_correction_decisions d
              WHERE d.correction_id = c.id
              ORDER BY d.occurred_at DESC, d.id DESC LIMIT 1
           ) d ON true
          ORDER BY c.occurred_at DESC`,
      )
    },

    async decideCorrection(actor: AttendanceMaintenanceAdminActor, input: Record<string, unknown>) {
      const correctionId = clean(input.correctionId, 200)
      const decision = clean(input.decision, 40)
      const reason = clean(input.reason, 1000)
      if (!correctionId || !['approved', 'rejected', 'clarification'].includes(decision) || reason.length < 2) {
        throw new AttendanceMaintenanceAdminError('Korrektur, Entscheidung und Begründung sind erforderlich.', 400, 'INVALID_DECISION')
      }
      const sql = await connection()
      const corrections = await sql.query(`SELECT * FROM attendance_corrections WHERE id = $1`, [correctionId])
      const correction = corrections[0]
      if (!correction) throw new AttendanceMaintenanceAdminError('Korrekturantrag nicht gefunden.', 404, 'CORRECTION_NOT_FOUND')
      const latest = await sql.query(
        `SELECT decision FROM attendance_correction_decisions WHERE correction_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [correctionId],
      )
      if (['approved', 'rejected'].includes(String(latest[0]?.decision || ''))) {
        throw new AttendanceMaintenanceAdminError('Dieser Korrekturantrag wurde bereits endgültig entschieden.', 409, 'DECISION_FINAL')
      }
      const requested = cleanRequestedData(correction.after_data)
      const afterData = decision === 'approved'
        ? cleanRequestedData(input.afterData && typeof input.afterData === 'object' ? input.afterData : requested)
        : correction.before_data
      const requestData = {
        id: correction.id,
        eventId: correction.event_id,
        requestedBy: correction.requested_by,
        reason: correction.reason,
        occurredAt: new Date(correction.occurred_at).toISOString(),
      }
      const id = `attendance-decision:${crypto.randomUUID()}`
      const now = new Date().toISOString()
      await sql.query(
        `INSERT INTO attendance_correction_decisions
           (id, correction_id, decision, actor_id, actor_email, actor_role, reason,
            request_data, before_data, after_data, occurred_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::timestamptz,$11::timestamptz + interval '24 months')`,
        [id, correctionId, decision, actor.userId, actor.email, actor.role, reason,
          JSON.stringify(requestData), JSON.stringify(correction.before_data), JSON.stringify(afterData), now],
      )
      await sql.query(
        `INSERT INTO attendance_audit_log
           (id, occurred_at, actor_id, actor_email, actor_role, action, entity_type, entity_id, reason, before_data, after_data, expires_at)
         VALUES ($1,$2::timestamptz,$3,$4,$5,$6,'attendance_correction',$7,$8,$9::jsonb,$10::jsonb,$2::timestamptz + interval '24 months')`,
        [`attendance-audit:${crypto.randomUUID()}`, now, actor.userId, actor.email, actor.role, `correction-${decision}`, correctionId, reason,
          JSON.stringify(correction.before_data), JSON.stringify(afterData)],
      )
      return { id, correctionId, decision }
    },

    async retention(actor: AttendanceMaintenanceAdminActor, apply: boolean) {
      if (!['owner', 'admin'].includes(actor.role)) {
        throw new AttendanceMaintenanceAdminError('Nur die Administration darf Aufbewahrungsdaten bereinigen.', 403, 'ADMIN_REQUIRED')
      }
      const sql = await connection()
      const locationCount = await sql.query(
        `SELECT count(*)::int AS count FROM attendance_locations l
          WHERE l.expires_at <= now()
            AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
      )
      const eventCount = await sql.query(
        `SELECT count(*)::int AS count FROM attendance_events e
          WHERE e.expires_at <= now()
            AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
      )
      if (apply) {
        await sql.query(
          `DELETE FROM attendance_locations l WHERE l.expires_at <= now()
            AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = l.event_id AND h.held)`,
        )
        await sql.query(
          `DELETE FROM attendance_events e WHERE e.expires_at <= now()
            AND NOT EXISTS (SELECT 1 FROM attendance_legal_holds h WHERE h.entity_type = 'attendance_event' AND h.entity_id = e.id AND h.held)`,
        )
      }
      return {
        dryRun: !apply,
        expiredLocations: locationCount[0]?.count || 0,
        expiredEvents: eventCount[0]?.count || 0,
      }
    },
  }
}

export function attendanceMaintenanceAdminService() {
  return createAttendanceMaintenanceAdminService()
}
