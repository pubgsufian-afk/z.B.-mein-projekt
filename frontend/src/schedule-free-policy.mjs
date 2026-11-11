// Pure presentation policy: unscheduled days are free only in an explicitly
// published calendar week, never across future, unpublished weeks.
function employeeId(employee) {
  return String(employee?.userId || employee?.id || '')
}

export function unassignedEmployeesByDate({ days, employees, entries, daysOff, show }) {
  if (!show) return {}
  const occupied = new Set([
    ...entries.map((entry) => `${String(entry.employeeUserId)}|${entry.date}`),
    ...daysOff.map((off) => `${String(off.employeeUserId)}|${off.date}`),
  ])
  const active = employees.filter((employee) =>
    employee.status === 'active' && Boolean(employeeId(employee)))
  return Object.fromEntries(days.map((date) => [
    date,
    active.filter((employee) => !occupied.has(`${employeeId(employee)}|${date}`)),
  ]))
}

export function employeePublishedDaysOff({ days, daysOff, weekPublished, visibleEntries, userId }) {
  const explicit = daysOff.filter((off) => String(off.employeeUserId) === String(userId))
  if (!weekPublished) return explicit
  const assigned = new Set(visibleEntries.map((entry) => entry.date))
  const alreadyFree = new Set(explicit.map((off) => off.date))
  const automatic = days.filter((date) => !assigned.has(date) && !alreadyFree.has(date))
    .map((date) => ({ employeeUserId: userId, date, source: 'automatic' }))
  return [...explicit, ...automatic].sort((a, b) => a.date.localeCompare(b.date))
}
