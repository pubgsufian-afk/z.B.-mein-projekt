import { getStore } from '@netlify/blobs'

export type ScheduleAssistAdminActor = { userId: string; role: 'owner' | 'admin' | 'manager' }

export class ScheduleAssistAdminError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'SCHEDULE_ASSIST_ERROR') {
    super(message)
    this.name = 'ScheduleAssistAdminError'
    this.status = status
    this.code = code
  }
}

function store() {
  return getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
}

function clean(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

async function readMany<T>(prefix: string) {
  const listed = await store().list({ prefix })
  const values = await Promise.all(listed.blobs.map((blob) => store().get(blob.key, { type: 'json' }) as Promise<T | null>))
  return values.filter((value): value is T => Boolean(value))
}

function timeMinutes(value: unknown) {
  const [hours, minutes] = String(value || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

function overlaps(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftStart = timeMinutes(left.start)
  const leftEnd = timeMinutes(left.end)
  const rightStart = timeMinutes(right.start)
  const rightEnd = timeMinutes(right.end)
  return left.employeeUserId === right.employeeUserId
    && left.date === right.date
    && leftStart !== null && leftEnd !== null && rightStart !== null && rightEnd !== null
    && leftStart < rightEnd && rightStart < leftEnd
}

function monday(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) throw new ScheduleAssistAdminError('Die Woche ist ungültig.', 400, 'INVALID_WEEK')
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export function createScheduleAssistAdminService() {
  return {
    async listTemplates() {
      return await readMany<Record<string, unknown>>('templates/')
    },

    async suggestions(input: Record<string, unknown>) {
      const date = clean(input.date, 10)
      const start = clean(input.start, 5)
      const end = clean(input.end, 5)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || timeMinutes(start) === null || timeMinutes(end) === null) {
        throw new ScheduleAssistAdminError('Datum, Beginn und Ende sind erforderlich.', 400, 'INVALID_SUGGESTION_RANGE')
      }
      const shifts = await readMany<Record<string, unknown>>('shifts/')
      const employees = new Map<string, string>()
      for (const shift of shifts) {
        const userId = clean(shift.employeeUserId, 200)
        if (userId) employees.set(userId, clean(shift.employeeName, 300) || userId)
      }
      return [...employees].map(([employeeUserId, employeeName]) => {
        const conflicts = shifts.filter((shift) => overlaps(shift, { date, start, end, employeeUserId }))
        return {
          employeeUserId,
          employeeName,
          available: conflicts.length === 0,
          conflicts: conflicts.map((shift) => clean(shift.id, 200)).filter(Boolean),
        }
      }).sort((left, right) => Number(right.available) - Number(left.available) || left.employeeName.localeCompare(right.employeeName, 'de'))
    },

    async reviewWeek(input: Record<string, unknown>) {
      const week = monday(clean(input.week, 10) || new Date().toISOString().slice(0, 10))
      const shifts = await readMany<Record<string, unknown>>('shifts/')
      const weekShifts = shifts.filter((shift) => {
        const date = clean(shift.date, 10)
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && monday(date) === week
      })
      const conflicts: Array<Record<string, unknown>> = []
      for (let leftIndex = 0; leftIndex < weekShifts.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < weekShifts.length; rightIndex += 1) {
          const left = weekShifts[leftIndex]
          const right = weekShifts[rightIndex]
          if (overlaps(left, right)) {
            conflicts.push({
              left: clean(left.id, 200),
              right: clean(right.id, 200),
              employeeName: clean(left.employeeName, 300),
              date: clean(left.date, 10),
            })
          }
        }
      }
      return {
        week,
        shiftCount: weekShifts.length,
        draftCount: weekShifts.filter((shift) => shift.status !== 'published').length,
        conflicts,
      }
    },

    async saveTemplate(actor: ScheduleAssistAdminActor, input: Record<string, unknown>) {
      const name = clean(input.name, 300)
      if (!name) throw new ScheduleAssistAdminError('Ein Vorlagenname ist erforderlich.', 400, 'NAME_REQUIRED')
      const id = clean(input.id, 200) || crypto.randomUUID()
      const pauseMinutes = Number(input.pauseMinutes || 0)
      if (!Number.isFinite(pauseMinutes) || pauseMinutes < 0 || !Number.isInteger(pauseMinutes)) {
        throw new ScheduleAssistAdminError('Die Pause ist ungültig.', 400, 'INVALID_PAUSE')
      }
      const template = {
        id,
        name,
        start: clean(input.start, 5),
        end: clean(input.end, 5),
        pauseMinutes,
        location: clean(input.location, 300),
        workArea: clean(input.workArea, 300),
        objectId: clean(input.objectId, 200) || null,
        note: clean(input.note, 1000),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.userId,
      }
      await store().setJSON(`templates/${id}`, template)
      return template
    },

    async deleteTemplate(input: Record<string, unknown>) {
      const id = clean(input.id, 200)
      if (!id) throw new ScheduleAssistAdminError('Vorlagen-ID fehlt.', 400, 'TEMPLATE_REQUIRED')
      const existing = await store().get(`templates/${id}`, { type: 'json' }) as Record<string, unknown> | null
      if (!existing) throw new ScheduleAssistAdminError('Vorlage wurde nicht gefunden.', 404, 'TEMPLATE_NOT_FOUND')
      await store().delete(`templates/${id}`)
      return { deleted: true, id }
    },
  }
}

export function scheduleAssistAdminService() {
  return createScheduleAssistAdminService()
}
