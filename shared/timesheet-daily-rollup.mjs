function safeMinutes(value) {
  const minutes = Number(value)
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
}

function clockValue(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function rowRange(row) {
  const start = clockValue(row.start)
  const rawEnd = clockValue(row.end)
  if (start === null || rawEnd === null) return null
  return { start, end: rawEnd <= start ? rawEnd + 24 * 60 : rawEnd }
}

function identityFor(row) {
  const userId = String(row.employeeUserId || row.userId || '').trim()
  const employeeName = String(row.employeeName || 'Mitarbeiter').trim() || 'Mitarbeiter'
  return {
    userId,
    employeeName,
    key: userId ? `id:${userId}` : `unregistered:${employeeName}`,
  }
}

/**
 * Produces one display row per employee and work date without changing the
 * underlying schedule entries. Net time is summed entry-by-entry, so gaps
 * between shifts never become paid work time.
 */
export function rollupDailyTimesheetRows(rows = []) {
  const days = new Map()

  for (const row of rows) {
    if (!row) continue
    const workDate = String(row.workDate || row.date || '').trim()
    if (!workDate) continue
    const identity = identityFor(row)
    const key = `${identity.key}|${workDate}`
    const current = days.get(key) || {
      id: `daily:${identity.key}:${workDate}`,
      employeeUserId: identity.userId,
      userId: identity.userId,
      employeeName: identity.employeeName,
      workDate,
      date: workDate,
      start: '–',
      end: '–',
      pauseMinutes: 0,
      netMinutes: 0,
      entries: [],
      firstStartValue: null,
      lastEndValue: null,
    }

    current.entries.push(row)
    current.pauseMinutes += safeMinutes(row.pauseMinutes ?? row.breakMinutes)
    current.netMinutes += safeMinutes(row.netMinutes)

    const range = rowRange(row)
    if (range && (current.firstStartValue === null || range.start < current.firstStartValue)) {
      current.firstStartValue = range.start
      current.start = String(row.start)
    }
    if (range && (current.lastEndValue === null || range.end > current.lastEndValue)) {
      current.lastEndValue = range.end
      current.end = String(row.end)
    }

    days.set(key, current)
  }

  return [...days.values()]
    .map(({ firstStartValue, lastEndValue, ...day }) => ({ ...day, entryCount: day.entries.length }))
    .sort((left, right) =>
      `${left.employeeName}-${left.workDate}-${left.start}`.localeCompare(
        `${right.employeeName}-${right.workDate}-${right.start}`,
        'de',
      ),
    )
}

export function pauseDisplay(minutes) {
  const total = safeMinutes(minutes)
  return total > 0 ? `${total} Min.` : '–'
}
