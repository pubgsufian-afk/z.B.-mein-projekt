function safeMinutes(value) {
  const minutes = Number(value)
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
}

export function plannedNetMinutes(date, start, end, pauseMinutes = 0) {
  if (!date || !/^\d{2}:\d{2}$/.test(String(start || '')) || !/^\d{2}:\d{2}$/.test(String(end || ''))) return 0
  const startAt = new Date(`${date}T${start}:00`)
  let endAt = new Date(`${date}T${end}:00`)
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return 0
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000)
  const gross = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000))
  return Math.max(0, gross - safeMinutes(pauseMinutes))
}

export function buildActualSessions(entries = [], employeeNames = new Map()) {
  const names = employeeNames instanceof Map ? employeeNames : new Map(Object.entries(employeeNames || {}))
  const byUser = new Map()
  const ordered = [...entries].sort((left, right) => {
    const byTime = String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || ''))
    return byTime || String(left.id || '').localeCompare(String(right.id || ''))
  })

  for (const event of ordered) {
    const userId = String(event.userId || event.user_id || '').trim()
    if (!userId) continue
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId).push(event)
  }

  const sessions = []
  for (const [userId, events] of byUser) {
    let current = null
    for (const event of events) {
      const action = event.action
      if (action === 'clock-in') {
        if (current) sessions.push({ ...current, open: true, netMinutes: 0 })
        current = {
          userId,
          employeeName: event.employeeName || names.get(userId) || 'Mitarbeiter',
          date: event.eventDate || String(event.clientOccurredAt || '').slice(0, 10),
          clockInEventId: event.id,
          clockOutEventId: null,
          clockInAt: event.clientOccurredAt,
          clockOutAt: null,
          breakMinutes: 0,
          breakStart: null,
          location: event.workSiteName || (typeof event.location === 'string' ? event.location : '') || event.objectId || '–',
          scheduleId: event.scheduleId || null,
          objectId: event.objectId || null,
        }
        continue
      }
      if (!current) continue
      if (action === 'break-start') {
        current.breakStart = event.clientOccurredAt
        continue
      }
      if (action === 'break-end' && current.breakStart) {
        current.breakMinutes += Math.max(0, Math.round((new Date(event.clientOccurredAt).getTime() - new Date(current.breakStart).getTime()) / 60000))
        current.breakStart = null
        continue
      }
      if (action === 'clock-out') {
        current.clockOutEventId = event.id
        current.clockOutAt = event.clientOccurredAt
        if (event.pauseMinutesAdjustment !== null && event.pauseMinutesAdjustment !== undefined) current.breakMinutes = safeMinutes(event.pauseMinutesAdjustment)
        const gross = Math.max(0, Math.round((new Date(current.clockOutAt).getTime() - new Date(current.clockInAt).getTime()) / 60000))
        current.netMinutes = Math.max(0, gross - current.breakMinutes)
        current.open = false
        sessions.push(current)
        current = null
      }
    }
    if (current) sessions.push({ ...current, open: true, netMinutes: 0 })
  }

  return sessions.sort((left, right) => `${left.date || ''}-${left.employeeName || ''}-${left.clockInAt || ''}`.localeCompare(`${right.date || ''}-${right.employeeName || ''}-${right.clockInAt || ''}`, 'de'))
}

export function buildPlannedRows(entries = [], employeeNames = new Map()) {
  const names = employeeNames instanceof Map ? employeeNames : new Map(Object.entries(employeeNames || {}))
  return [...entries].map((entry) => {
    const userId = String(entry.employeeUserId || entry.userId || '').trim()
    const pauseMinutes = safeMinutes(entry.pauseMinutes)
    return {
      id: entry.id || '',
      userId,
      employeeName: entry.employeeName || names.get(userId) || 'Mitarbeiter',
      date: entry.date || '',
      start: entry.start || '',
      end: entry.end || '',
      pauseMinutes,
      netMinutes: plannedNetMinutes(entry.date, entry.start, entry.end, pauseMinutes),
      location: entry.location || '–',
      workArea: entry.workArea || '',
      objectId: entry.objectId || null,
      status: entry.status || '',
    }
  }).sort((left, right) => `${left.date}-${left.employeeName}-${left.start}`.localeCompare(`${right.date}-${right.employeeName}-${right.start}`, 'de'))
}

export function sumMinutes(rows = [], field = 'netMinutes') {
  return rows.reduce((total, row) => total + safeMinutes(row?.[field]), 0)
}

export function totalsByEmployee(rows = [], field = 'netMinutes') {
  const totals = new Map()
  for (const row of rows) {
    const name = row.employeeName || 'Mitarbeiter'
    totals.set(name, (totals.get(name) || 0) + safeMinutes(row?.[field]))
  }
  return [...totals.entries()].map(([employeeName, minutes]) => ({ employeeName, minutes })).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'de'))
}
