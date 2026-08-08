function berlinClock(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || '00'
  return `${part('hour')}:${part('minute')}`
}

function rowKey(row) {
  return `${row.userId || ''}|${row.date || ''}`
}

function chooseFallbackPlan(actual, plans, used) {
  const candidates = plans.filter((plan, index) => !used.has(index) && rowKey(plan) === rowKey(actual))
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]
  const actualStart = berlinClock(actual.clockInAt)
  return candidates.find((plan) => plan.start === actualStart) || null
}

export function mergeTimesheetRows(actualRows = [], plannedRows = []) {
  const plans = [...plannedRows]
  const used = new Set()
  const byId = new Map(plans.map((plan, index) => [String(plan.id || ''), { plan, index }]).filter(([id]) => id))
  const merged = []

  for (const actual of actualRows) {
    let matched = null
    let matchedIndex = -1
    const direct = actual.scheduleId ? byId.get(String(actual.scheduleId)) : null
    if (direct && !used.has(direct.index)) {
      matched = direct.plan
      matchedIndex = direct.index
    } else {
      matched = chooseFallbackPlan(actual, plans, used)
      if (matched) matchedIndex = plans.indexOf(matched)
    }
    if (matchedIndex >= 0) used.add(matchedIndex)

    merged.push({
      ...matched,
      ...actual,
      source: 'actual',
      scheduleId: actual.scheduleId || matched?.id || null,
      objectId: actual.objectId || matched?.objectId || null,
      start: berlinClock(actual.clockInAt) || matched?.start || '',
      end: berlinClock(actual.clockOutAt) || matched?.end || '',
      location: actual.location && actual.location !== '–' ? actual.location : matched?.location || '–',
      workArea: matched?.workArea || actual.workArea || '',
    })
  }

  plans.forEach((plan, index) => {
    if (used.has(index)) return
    merged.push({ ...plan, source: 'planned', scheduleId: plan.id || null, open: false })
  })

  return merged.sort((left, right) => {
    const a = `${left.date || ''}-${left.employeeName || ''}-${left.start || ''}`
    const b = `${right.date || ''}-${right.employeeName || ''}-${right.start || ''}`
    return a.localeCompare(b, 'de')
  })
}
