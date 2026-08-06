function berlinDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function eventDate(event) {
  if (event?.eventDate) return String(event.eventDate)
  const date = new Date(event?.clientOccurredAt || '')
  return Number.isFinite(date.getTime()) ? berlinDate(date) : ''
}

function resetOldLocalState() {
  const app = window.HabunAttendanceV2
  if (!app?.model) return
  const today = berlinDate()
  const events = Array.isArray(app.model.state.events) ? app.model.state.events : []
  const todayEvents = events.filter((event) => eventDate(event) === today)
  if (todayEvents.length === events.length) return
  const last = todayEvents.at(-1)
  app.model.state = {
    ...app.model.state,
    phase: !last ? 'idle' : last.action === 'clock-in' ? 'working' : 'completed',
    clockInAt: [...todayEvents].reverse().find((event) => event.action === 'clock-in')?.clientOccurredAt || null,
    clockOutAt: last?.action === 'clock-out' ? last.clientOccurredAt : null,
    events: todayEvents,
  }
  localStorage.setItem('habun-attendance-state-v2', JSON.stringify(app.model.state))
  app.refresh()
}

window.addEventListener('habun:v2-ready', resetOldLocalState)
if (window.HabunAttendanceV2) resetOldLocalState()
