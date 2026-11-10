// Pure helpers shared by planning UI and its contract tests.
export function employeeOnDayOff(daysOff, employeeUserId, date) {
  if (!date || !employeeUserId) return false
  return (Array.isArray(daysOff) ? daysOff : []).some((day) =>
    day.date === date && String(day.employeeUserId) === String(employeeUserId))
}

export function schedulableEmployees(employees, daysOff, date) {
  return (Array.isArray(employees) ? employees : []).filter((employee) =>
    !employeeOnDayOff(daysOff, employee.userId || employee.id, date))
}
