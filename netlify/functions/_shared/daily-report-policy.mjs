/** Tagesberichte are visible to the author or to company administrators only. */
export const DAILY_REPORT_ROLES = ['owner', 'admin', 'manager', 'employee']

export function canSubmitDailyReport(role) {
  return DAILY_REPORT_ROLES.includes(String(role || ''))
}

export function canManageDailyReport(role) {
  return role === 'owner' || role === 'admin'
}

export function mayReadDailyReport(actor, report) {
  if (!actor || !report || !actor.userId) return false
  return canManageDailyReport(actor.role) || (
    canSubmitDailyReport(actor.role) && report.authorId === actor.userId
  )
}
