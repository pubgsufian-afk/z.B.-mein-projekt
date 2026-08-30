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

function clockMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

function rowKey(row) {
  return `${row.userId || ''}|${row.date || ''}`
}

function readableLocation(actual, planned) {
  const actualLocation = String(actual?.location || '').trim()
  const objectId = String(actual?.objectId || '').trim()
  const plannedLocation = String(planned?.location || '').trim()
  const looksInternal = actualLocation && (actualLocation === objectId || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualLocation))
  if (plannedLocation && plannedLocation !== '–' && looksInternal) return plannedLocation
  if (actualLocation && actualLocation !== '–') return actualLocation
  return plannedLocation || '–'
}

function chooseFallbackPlan(actual, plans, used) {
  const candidates = plans.filter((plan, index) => !used.has(index) && rowKey(plan) === rowKey(actual))
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]
  const actualStart = berlinClock(actual.clockInAt)
  const exact = candidates.find((plan) => plan.start === actualStart)
  if (exact) return exact
  const actualMinutes = clockMinutes(actualStart)
  if (actualMinutes === null) return null
  const nearest = candidates
    .map((plan) => ({ plan, difference: Math.abs((clockMinutes(plan.start) ?? 10000) - actualMinutes) }))
    .sort((left, right) => left.difference - right.difference)[0]
  return nearest && nearest.difference <= 180 ? nearest.plan : null
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
      location: readableLocation(actual, matched),
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
