// Pure policy helpers: imported by the server functions and tested without Netlify.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function validSelfServiceRange(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return null
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null
  const startTime = Date.parse(from + 'T12:00:00Z')
  const endTime = Date.parse(to + 'T12:00:00Z')
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  if (new Date(startTime).toISOString().slice(0, 10) !== from) return null
  if (new Date(endTime).toISOString().slice(0, 10) !== to) return null
  const days = (endTime - startTime) / 86400000
  return days >= 0 && days <= 370 ? { from, to } : null
}
export function mayManageEmployeeDocuments(role) {
  return role === 'owner' || role === 'admin'
}
export function mayDownloadEmployeeDocument(actor, document) {
  if (!actor?.userId || !document || document.revoked_at) return false
  return mayManageEmployeeDocuments(actor.role) || document.employee_user_id === actor.userId
}
export function mayPublishToRecipient(actorRole, recipientAccess) {
  return mayManageEmployeeDocuments(actorRole)
    && recipientAccess?.status === 'active'
    && recipientAccess.role !== 'pending'
}
