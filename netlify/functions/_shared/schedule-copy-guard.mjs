function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('de')
}

export function sameScheduleShift(left = {}, right = {}) {
  return String(left.employeeUserId || '') === String(right.employeeUserId || '')
    && String(left.date || '') === String(right.date || '')
    && String(left.start || '') === String(right.start || '')
    && String(left.end || '') === String(right.end || '')
    && normalized(left.location) === normalized(right.location)
    && normalized(left.workArea) === normalized(right.workArea)
}
