import {
  AttendanceServiceError,
  createAttendanceService as createBaseAttendanceService,
  eventDateInBerlin,
  normalizeClockRequest,
} from './attendance-service.mts'

export { AttendanceServiceError, eventDateInBerlin, normalizeClockRequest }

export function createAttendanceService(options: Record<string, any>) {
  const repository = options.repository
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const scopedRepository = {
    ...repository,
    async listEvents(userId: string) {
      const entries = await repository.listEvents(userId)
      const today = eventDateInBerlin(now())
      return (Array.isArray(entries) ? entries : []).filter((entry) => String(entry.eventDate || '') === today)
    },
  }
  return createBaseAttendanceService({ ...options, repository: scopedRepository, now })
}
