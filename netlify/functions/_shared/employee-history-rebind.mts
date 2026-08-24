import { getDatabase } from '@netlify/database'
import { isProvisionalEmployeeUserId } from './schedule-provisional-employee.mts'
import type { AttendanceAdminActor } from './attendance-admin-service.mts'

type RebindDomain = 'schedule' | 'attendance'

export type EmployeeHistoryRebindInput = {
  sourceUserId: string
  targetUserId: string
  targetFullName: string
  from: string
  to: string
  domains: RebindDomain[]
  reason: string
  range: { from: string; to: string }
}

type ScheduleRebindResult = { shiftCount: number; timesheetCount: number }
type AttendanceRebindResult = { eventCount: number; locationCount: number; adjustmentCount: number }

type RebindRepository = {
  rebindSchedule(input: EmployeeHistoryRebindInput, actor: AttendanceAdminActor): Promise<ScheduleRebindResult>
  rebindAttendance(input: EmployeeHistoryRebindInput, actor: AttendanceAdminActor): Promise<AttendanceRebindResult>
  transaction?<T>(fn: (repository: RebindRepository) => Promise<T>): Promise<T>
}

export class EmployeeHistoryRebindError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'EMPLOYEE_HISTORY_REBIND_ERROR') {
    super(message)
    this.name = 'EmployeeHistoryRebindError'
    this.status = status
    this.code = code
  }
}

function text(value: unknown, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function normalizeEmployeeHistoryRebind(raw: Record<string, unknown>): EmployeeHistoryRebindInput {
  const sourceUserId = text(raw.sourceUserId, 300)
  const targetUserId = text(raw.targetUserId, 300)
  const targetFullName = text(raw.targetFullName, 300)
  const from = text(raw.from, 20)
  const to = text(raw.to, 20)
  const reason = text(raw.reason, 1000)
  const requested = Array.isArray(raw.domains) ? raw.domains.map((value) => text(value, 30)) : []
  const domains = [...new Set(requested)].filter((value): value is RebindDomain => value === 'schedule' || value === 'attendance')

  if (!sourceUserId || !targetUserId) throw new TypeError('Quell- und Zielmitarbeiter sind erforderlich.')
  if (sourceUserId === targetUserId) throw new TypeError('Quell- und Zielmitarbeiter müssen unterschiedlich sein.')
  if (isProvisionalEmployeeUserId(targetUserId)) throw new TypeError('Das Ziel muss ein registrierter Mitarbeiter sein.')
  if (!targetFullName) throw new TypeError('Der registrierte Mitarbeitername ist erforderlich.')
  if (!validDate(from) || !validDate(to) || to < from) throw new TypeError('Zeitraum ist ungültig.')
  if (!domains.length || domains.length !== new Set(requested).size) throw new TypeError('Umbindungsbereiche sind ungültig.')
  if (reason.length < 2) throw new TypeError('Eine Begründung ist erforderlich.')

  return { sourceUserId, targetUserId, targetFullName, from, to, domains, reason, range: { from, to } }
}

function int(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function databaseRepository(client: any): RebindRepository {
  return {
    async rebindSchedule(input, actor) {
      const conflict = await client.query(
        `SELECT source.id
           FROM schedule_shifts source
           JOIN schedule_shifts target
             ON target.employee_user_id = $2
            AND target.id <> source.id
            AND target.shift_date = source.shift_date
            AND target.start_time = source.start_time
            AND target.end_time = source.end_time
            AND lower(btrim(target.location)) = lower(btrim(source.location))
            AND lower(btrim(target.work_area)) = lower(btrim(source.work_area))
          WHERE source.employee_user_id = $1
            AND source.shift_date BETWEEN $3::date AND $4::date
          LIMIT 1`,
        [input.sourceUserId, input.targetUserId, input.from, input.to],
      )
      if (conflict.rows?.length) {
        throw new EmployeeHistoryRebindError('Die Umbindung würde einen doppelten Dienst erzeugen.', 409, 'SCHEDULE_DUPLICATE_CONFLICT')
      }

      const shifts = await client.query(
        `UPDATE schedule_shifts
            SET employee_user_id = $2,
                employee_name = $3,
                updated_at = now(),
                updated_by = $6
          WHERE employee_user_id = $1
            AND shift_date BETWEEN $4::date AND $5::date
          RETURNING id`,
        [input.sourceUserId, input.targetUserId, input.targetFullName, input.from, input.to, actor.userId],
      )
      const timesheets = await client.query(
        `UPDATE timesheet_entries
            SET employee_user_id = $2,
                employee_name = $3,
                updated_at = now(),
                updated_by = $6
          WHERE employee_user_id = $1
            AND work_date BETWEEN $4::date AND $5::date
          RETURNING id`,
        [input.sourceUserId, input.targetUserId, input.targetFullName, input.from, input.to, actor.userId],
      )
      const shiftCount = int(shifts.rowCount ?? shifts.rows?.length)
      const timesheetCount = int(timesheets.rowCount ?? timesheets.rows?.length)

      await client.query(
        `INSERT INTO schedule_audit_log
           (id, occurred_at, actor_id, actor_type, action, shift_id, details)
         VALUES ($1, now(), $2, 'chatgpt', 'employee-history-rebind', NULL, $3::jsonb)`,
        [crypto.randomUUID(), actor.userId, JSON.stringify({
          sourceUserId: input.sourceUserId,
          targetUserId: input.targetUserId,
          from: input.from,
          to: input.to,
          shiftCount,
          timesheetCount,
          reason: input.reason,
        })],
      )
      return { shiftCount, timesheetCount }
    },

    async rebindAttendance(input, actor) {
      const events = await client.query(
        `SELECT id, action, client_occurred_at, event_date
           FROM attendance_events
          WHERE user_id = $1
            AND event_date BETWEEN $2::date AND $3::date
          ORDER BY event_date, client_occurred_at, id`,
        [input.sourceUserId, input.from, input.to],
      )
      const eventIds = (events.rows || []).map((row: any) => text(row.id, 300)).filter(Boolean)

      if (eventIds.length) {
        const holds = await client.query(
          `SELECT entity_id
             FROM attendance_legal_holds
            WHERE entity_type = 'attendance_event'
              AND held = true
              AND entity_id = ANY($1::text[])`,
          [eventIds],
        )
        if (holds.rows?.length) {
          throw new EmployeeHistoryRebindError('Mindestens eine Buchung steht unter Aufbewahrungsschutz.', 409, 'LEGAL_HOLD')
        }

        const duplicate = await client.query(
          `SELECT source.id
             FROM attendance_events source
             JOIN attendance_events target
               ON target.user_id = $2
              AND target.id <> source.id
              AND target.action = source.action
              AND target.event_date = source.event_date
              AND target.client_occurred_at = source.client_occurred_at
            WHERE source.user_id = $1
              AND source.event_date BETWEEN $3::date AND $4::date
            LIMIT 1`,
          [input.sourceUserId, input.targetUserId, input.from, input.to],
        )
        if (duplicate.rows?.length) {
          throw new EmployeeHistoryRebindError('Die Umbindung würde eine doppelte Zeiterfassungsbuchung erzeugen.', 409, 'ATTENDANCE_DUPLICATE_CONFLICT')
        }
      }

      const updatedLocations = await client.query(
        `UPDATE attendance_locations
            SET user_id = $2
          WHERE user_id = $1
            AND event_id = ANY($3::text[])
          RETURNING event_id`,
        [input.sourceUserId, input.targetUserId, eventIds],
      )
      const updatedEvents = await client.query(
        `UPDATE attendance_events
            SET user_id = $2
          WHERE user_id = $1
            AND event_date BETWEEN $3::date AND $4::date
          RETURNING id`,
        [input.sourceUserId, input.targetUserId, input.from, input.to],
      )
      const updatedAdjustments = await client.query(
        `UPDATE attendance_adjustments
            SET user_id = $2
          WHERE user_id = $1
            AND event_date BETWEEN $3::date AND $4::date
          RETURNING id`,
        [input.sourceUserId, input.targetUserId, input.from, input.to],
      )
      const eventCount = int(updatedEvents.rowCount ?? updatedEvents.rows?.length)
      const locationCount = int(updatedLocations.rowCount ?? updatedLocations.rows?.length)
      const adjustmentCount = int(updatedAdjustments.rowCount ?? updatedAdjustments.rows?.length)
      const now = new Date().toISOString()

      await client.query(
        `INSERT INTO attendance_audit_log
           (id, occurred_at, actor_id, actor_email, actor_role, action,
            entity_type, entity_id, reason, before_data, after_data, expires_at)
         VALUES ($1, $2::timestamptz, $3, $4, $5, 'admin-employee-rebind',
                 'employee_history', $6, $7, $8::jsonb, $9::jsonb,
                 $2::timestamptz + interval '24 months')`,
        [
          `attendance-audit:${crypto.randomUUID()}`,
          now,
          actor.userId,
          actor.email,
          actor.role,
          `${input.sourceUserId}:${input.targetUserId}:${input.from}:${input.to}`,
          input.reason,
          JSON.stringify({ sourceUserId: input.sourceUserId, from: input.from, to: input.to }),
          JSON.stringify({ targetUserId: input.targetUserId, targetFullName: input.targetFullName, eventCount, locationCount, adjustmentCount }),
        ],
      )
      return { eventCount, locationCount, adjustmentCount }
    },
  }
}

function defaultRepository(): RebindRepository {
  return {
    async rebindSchedule() {
      throw new Error('transaction required')
    },
    async rebindAttendance() {
      throw new Error('transaction required')
    },
    async transaction<T>(fn: (repository: RebindRepository) => Promise<T>) {
      const database = getDatabase()
      const client = await database.pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(databaseRepository(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export function createEmployeeHistoryRebindService(repository: RebindRepository = defaultRepository()) {
  const execute = async (input: EmployeeHistoryRebindInput, actor: AttendanceAdminActor, scoped: RebindRepository) => {
    const schedule = input.domains.includes('schedule')
      ? await scoped.rebindSchedule(input, actor)
      : { shiftCount: 0, timesheetCount: 0 }
    const attendance = input.domains.includes('attendance')
      ? await scoped.rebindAttendance(input, actor)
      : { eventCount: 0, locationCount: 0, adjustmentCount: 0 }
    return { range: input.range, sourceUserId: input.sourceUserId, targetUserId: input.targetUserId, schedule, attendance }
  }

  return {
    async rebind(input: EmployeeHistoryRebindInput, actor: AttendanceAdminActor) {
      if (repository.transaction) return repository.transaction((scoped) => execute(input, actor, scoped))
      return execute(input, actor, repository)
    },
  }
}

export function employeeHistoryRebindService() {
  return createEmployeeHistoryRebindService()
}
