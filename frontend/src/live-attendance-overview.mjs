// Read-only live attendance presentation; never writes time entries.
const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
export function berlinDay(value = new Date()) {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? dayFormatter.format(d) : ''
}
export function adjacentDay(day, offset) {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const minutes = ms => Math.floor(ms / 60000)
const timeOf = event => new Date(event.clientOccurredAt || '').getTime()
const dayOf = event => event.eventDate || berlinDay(event.clientOccurredAt)
export function groupLiveAttendance(entries, day, now = new Date()) {
  const current = berlinDay(now) === day
  const nowMs = new Date(now).getTime()
  const groups = new Map(), ids = new Set()
  for (const event of entries || []) {
    if (!event.userId || (event.id && ids.has(event.id))) continue
    if (event.id) ids.add(event.id)
    if (!groups.has(event.userId)) groups.set(event.userId, [])
    groups.get(event.userId).push(event)
  }
  const people = []
  for (const [userId, records] of groups) {
    records.sort((a,b) => timeOf(a)-timeOf(b) || String(a.serverOccurredAt || '').localeCompare(String(b.serverOccurredAt || '')) || String(a.id || '').localeCompare(String(b.id || '')))
    const sessions = []
    let active = null
    const make = event => ({ start: null, end: null, pauses: [], events: [], warnings: [], adjustment: null, site: event.workSiteName || '', area: event.workArea || '' })
    function close() { if (active) sessions.push(active); active = null }
    for (const event of records) {
      const t = timeOf(event)
      if (!Number.isFinite(t)) {
        const invalid = make(event); invalid.events.push(event); invalid.warnings.push('Ungültiger Zeitstempel'); sessions.push(invalid); continue
      }
      if (event.action === 'clock-in') {
        if (active) { active.warnings.push('Arbeitsende fehlt vor erneutem Beginn'); close() }
        active = make(event); active.start = t; active.events.push(event); continue
      }
      if (!active) { active = make(event); active.warnings.push('Arbeitsbeginn fehlt') }
      active.events.push(event)
      if (event.action === 'break-start') {
        if (active.pauses.at(-1)?.end === null) active.warnings.push('Pausenende fehlt vor erneutem Pausenbeginn')
        else active.pauses.push({ start: t, end: null })
      } else if (event.action === 'break-end') {
        const last = active.pauses.at(-1)
        if (!last || last.end !== null) { active.pauses.push({ start: null, end: t }); active.warnings.push('Pausenbeginn fehlt') }
        else last.end = t
      } else if (event.action === 'clock-out') {
        active.end = t
        if (active.pauses.at(-1)?.end === null) active.warnings.push('Pausenende fehlt')
        const raw = event.pauseMinutesAdjustment
        if (raw !== null && raw !== undefined) {
          const value = Number(raw)
          if (Number.isFinite(value) && value >= 0) active.adjustment = value
          else active.warnings.push('Ungültige Pausenkorrektur')
        }
        close()
      } else active.warnings.push('Unbekannte Buchungsart')
    }
    close()
    const relevant = sessions.filter(s => {
      const days = s.events.map(dayOf).filter(Boolean).sort()
      return days.includes(day) || (days[0] < day && ((days.at(-1) >= day) || (current && s.end === null && s.start !== null && nowMs-s.start < 86400000)))
    }).map(s => {
      const runningPause = s.pauses.at(-1)?.end === null
      const elapsedTo = s.end ?? (current && s.start !== null && nowMs >= s.start && nowMs-s.start < 86400000 ? nowMs : null)
      if (s.end === null && elapsedTo === null) s.warnings.push('Arbeitsende nicht gebucht')
      if (s.end === null && elapsedTo !== null && s.events.some(e => timeOf(e) > nowMs)) s.warnings.push('Zeitbuchung liegt in der Zukunft')
      const bookedMs = s.pauses.reduce((sum,p) => sum + (p.start !== null && p.end !== null && p.end >= p.start ? p.end-p.start : 0), 0)
      const openPause = runningPause && elapsedTo !== null && s.end === null ? s.pauses.at(-1) : null
      const openMs = openPause && elapsedTo >= openPause.start ? elapsedTo-openPause.start : 0
      const gross = s.start !== null && elapsedTo !== null && elapsedTo >= s.start ? elapsedTo-s.start : null
      const pauseMs = s.adjustment !== null ? s.adjustment*60000 : bookedMs+openMs
      if (gross !== null && pauseMs > gross) s.warnings.push('Pausendauer überschreitet Anwesenheit')
      const reliable = !s.warnings.length && gross !== null
      return { ...s, bookedPauseMinutes: minutes(bookedMs), runningPauseMinutes: openPause ? minutes(openMs) : null, pauseMinutes: reliable ? minutes(pauseMs) : null, netMinutes: reliable ? minutes(gross-pauseMs) : null, status: !reliable ? 'check' : s.end !== null ? 'completed' : runningPause ? 'paused' : 'working' }
    })
    if (!relevant.length) continue
    const display = [...records].reverse().find(e => e.employeeName && e.employeeName !== userId)
    people.push({ userId, name: display?.employeeName || 'Mitarbeiter · '+userId.slice(-8), sessions: relevant, status: relevant.at(-1).status })
  }
  return people.sort((a,b) => a.name.localeCompare(b.name,'de') || a.userId.localeCompare(b.userId))
}
