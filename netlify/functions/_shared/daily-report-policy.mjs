/** Only company administrators can read submitted daily reports. Staff can submit, never read. */
export const DAILY_REPORT_ROLES = ['owner', 'admin', 'manager', 'employee']

export function canSubmitDailyReport(role) {
  return DAILY_REPORT_ROLES.includes(String(role || ''))
}

export function canManageDailyReport(role) {
  return role === 'owner' || role === 'admin'
}

export function mayReadDailyReport(actor, report) {
  return Boolean(actor?.userId && report?.id && canManageDailyReport(actor.role))
}
