const BOUNDARY_ACTIONS = new Set(['clock-in', 'clock-out'])

export function attendanceEventNeedsReview(event = {}) {
  if (!BOUNDARY_ACTIONS.has(String(event.action || ''))) return false
  return Boolean(event.offline_captured) || String(event.location_status || '') !== 'inside'
}
