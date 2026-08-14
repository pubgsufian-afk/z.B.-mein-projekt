const BERLIN_TIME_ZONE = 'Europe/Berlin'

function normalizedKey(value) {
  return String(value || '').trim().toLocaleLowerCase('de')
}

function employeeKey(value) {
  const direct = value?.employeeUserId || value?.userId || value?.employeeId || value?.employee_id
  if (direct) return `id:${String(direct).trim()}`
  const name = value?.employeeName || value?.fullName || value?.name
  return name ? `name:${normalizedKey(name)}` : ''
}

function employeeName(value) {
  return String(value?.employeeName || value?.fullName || value?.name || '').trim() || 'Mitarbeiter'
}

function eventTimestamp(entry) {
  for (const candidate of [entry?.clientOccurredAt, entry?.occurredAt, entry?.createdAt, entry?.updatedAt]) {
    const value = Date.parse(String(candidate || ''))
    if (Number.isFinite(value)) return value
  }
  return 0
}

export function berlinDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function countReportWords(value) {
  const text = String(value || '').trim()
  return text ? text.split(/\s+/u).filter(Boolean).length : 0
}

export function buildDeploymentGroups(scheduleEntries = [], attendanceEntries = [], date = berlinDateKey()) {
  const scheduled = new Map()
  for (const entry of Array.isArray(scheduleEntries) ? scheduleEntries : []) {
    if (!entry || entry.date !== date || entry.status === 'draft') continue
    const key = employeeKey(entry)
    if (!key) continue
    const current = scheduled.get(key)
    if (!current) scheduled.set(key, { key, name: employeeName(entry) })
  }

  const latestByEmployee = new Map()
  for (const entry of Array.isArray(attendanceEntries) ? attendanceEntries : []) {
    if (!entry) continue
    if (entry.eventDate && String(entry.eventDate) !== date) continue
    const key = employeeKey(entry)
    if (!key || !scheduled.has(key)) continue
    const timestamp = eventTimestamp(entry)
    const previous = latestByEmployee.get(key)
    if (!previous || timestamp >= previous.timestamp) {
      latestByEmployee.set(key, { action: String(entry.action || ''), timestamp })
    }
  }

  const groups = { working: [], paused: [], notStarted: [], completed: [] }
  for (const employee of scheduled.values()) {
    const action = latestByEmployee.get(employee.key)?.action || ''
    if (action === 'clock-in' || action === 'break-end') groups.working.push(employee)
    else if (action === 'break-start') groups.paused.push(employee)
    else if (action === 'clock-out') groups.completed.push(employee)
    else groups.notStarted.push(employee)
  }

  for (const entries of Object.values(groups)) {
    entries.sort((left, right) => left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }))
  }
  return groups
}

export const ADMIN_OVERVIEW_TIME_ZONE = BERLIN_TIME_ZONE
