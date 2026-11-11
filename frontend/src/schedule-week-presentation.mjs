// Pure presentation helpers; employee, shift and leave records are not changed.
export function areaForShift(shift) {
  const label = String(shift?.workArea || '').trim()
  const lower = label.toLocaleLowerCase('de')
  if (lower.includes('brandwach')) return 'Brandwache'
  if (lower.includes('gmp')) return 'GMP'
  if (lower.includes('zuko') || lower.includes('zutritt') || lower.includes('pforte') || lower.includes('empfang')) return 'ZuKo'
  return label || 'Sonstige'
}

const priority = new Map([['Brandwache', 0], ['ZuKo', 1], ['GMP', 2]])

export function groupedScheduleShifts(entries = []) {
  const areas = new Map()
  for (const shift of entries) {
    const area = areaForShift(shift)
    if (!areas.has(area)) areas.set(area, [])
    areas.get(area).push(shift)
  }
  return [...areas].sort(([left], [right]) =>
    (priority.get(left) ?? 99) - (priority.get(right) ?? 99) || left.localeCompare(right, 'de')
  ).map(([label, shifts]) => ({
    label,
    shifts: [...shifts].sort((a, b) =>
      String(a.start || '').localeCompare(String(b.start || '')) ||
      String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'de')
    ),
  }))
}

export function dailyFreeEmployees({ shifts = [], explicitDaysOff = [], automaticUnassigned = [] }) {
  const assigned = new Set(shifts.map((shift) => String(shift.employeeUserId)))
  const free = new Map()
  for (const off of explicitDaysOff) {
    const id = String(off.employeeUserId || '')
    const name = String(off.employeeName || '').trim()
    if (!id || assigned.has(id) || /^\d+$/.test(name)) continue
    free.set(id, { employeeUserId: id, employeeName: name || 'Mitarbeiter', explicit: true, dayOff: off })
  }
  for (const employee of automaticUnassigned) {
    const id = String(employee.userId || employee.id || '')
    const name = String(employee.fullName || '').trim()
    // Filter bogus numeric placeholder account names like "12" without deleting accounts.
    if (!id || assigned.has(id) || free.has(id) || !name || /^\d+$/.test(name)) continue
    free.set(id, { employeeUserId: id, employeeName: name, explicit: false, dayOff: null })
  }
  return [...free.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de'))
}
