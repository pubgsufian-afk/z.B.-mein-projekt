import {
  attendanceControls,
  createClientEventId,
  enqueueAttendanceEvent,
  reduceAttendanceState,
  shouldRefreshSession,
  sortPendingEvents,
} from './attendance-core.js'

const STATE_KEY = 'habun-attendance-state-v2'
const QUEUE_KEY = 'habun-attendance-queue-v2'
const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

const model = {
  role: 'pending',
  restored: false,
  syncing: false,
  submitting: false,
  state: { phase: 'idle', clockInAt: null, clockOutAt: null, events: [], schedule: null },
  queue: [],
  panel: null,
  status: null,
}

function safeParse(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function saveLocal() {
  localStorage.setItem(STATE_KEY, JSON.stringify(model.state))
  localStorage.setItem(QUEUE_KEY, JSON.stringify(model.queue))
}

function roleFromSession(payload) {
  const candidates = [
    payload?.role,
    payload?.access?.role,
    payload?.user?.role,
    payload?.user?.app_metadata?.role,
    payload?.user?.appMetadata?.role,
    ...(Array.isArray(payload?.user?.roles) ? payload.user.roles : []),
    ...(Array.isArray(payload?.roles) ? payload.roles : []),
  ].map((value) => String(value || '').trim().toLowerCase())
  return candidates.find((value) => ['owner', 'admin', 'manager', 'employee', 'pending'].includes(value)) || 'employee'
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || `Anfrage fehlgeschlagen (${response.status})`)
    error.status = response.status
    error.code = payload.code
    throw error
  }
  return payload
}

function formatDateTime(value) {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : '–'
}

function formatDistance(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return 'nicht verfügbar'
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`
}

function locationLabel(status) {
  if (status === 'inside') return 'Innerhalb des Einsatzbereichs'
  if (status === 'outside') return 'Außerhalb des Einsatzbereichs'
  return 'Standort nicht verfügbar'
}

function status(message, tone = 'info') {
  model.status = { message, tone }
  const node = model.panel?.querySelector('[data-v2-status]')
  if (node) {
    node.textContent = message
    node.dataset.tone = tone
    node.hidden = !message
  }
}

function restoreLocal() {
  const state = safeParse(localStorage.getItem(STATE_KEY), null)
  const queue = safeParse(localStorage.getItem(QUEUE_KEY), [])
  if (state && typeof state === 'object') model.state = { ...model.state, ...state }
  model.queue = Array.isArray(queue) ? sortPendingEvents(queue) : []
  model.restored = true
}

function currentLastEvent() {
  const events = Array.isArray(model.state.events) ? model.state.events : []
  return events.at(-1) || null
}

function renderClock() {
  const section = model.panel?.querySelector('[data-section="clock"]')
  if (!section) return
  const controls = attendanceControls(model.state, model)
  const schedule = model.state.schedule || null
  const lastEvent = currentLastEvent()
  section.innerHTML = `
    <div class="habun-v2-grid">
      <article class="habun-v2-card">
        <h3>Heutiger Dienst</h3>
        <dl class="habun-v2-kv">
          <dt>Zeit</dt><dd>${schedule ? `${schedule.start || '–'}–${schedule.end || '–'}` : 'Kein veröffentlichter Dienst'}</dd>
          <dt>Einsatzort</dt><dd>${schedule?.location || '–'}</dd>
          <dt>Arbeitsbereich</dt><dd>${schedule?.workArea || '–'}</dd>
          <dt>Automatische Pause</dt><dd>${Number(schedule?.pauseMinutes || 0)} Minuten</dd>
        </dl>
      </article>
      <article class="habun-v2-card">
        <h3>Erfasste Zeit</h3>
        <dl class="habun-v2-kv">
          <dt>Arbeitsbeginn</dt><dd>${formatDateTime(model.state.clockInAt)}</dd>
          <dt>Arbeitsende</dt><dd>${formatDateTime(model.state.clockOutAt)}</dd>
          <dt>Status</dt><dd>${model.state.phase === 'working' ? 'Arbeitszeit läuft' : model.state.phase === 'completed' ? 'Dienst abgeschlossen' : 'Noch nicht begonnen'}</dd>
          <dt>Letzter Standort</dt><dd>${lastEvent ? locationLabel(lastEvent.locationStatus) : '–'}</dd>
          <dt>Entfernung</dt><dd>${formatDistance(lastEvent?.location?.distanceMeters)}</dd>
        </dl>
      </article>
    </div>
    <div class="habun-v2-actions">
      <button class="habun-v2-primary" type="button" data-clock-action="clock-in" ${controls.clockInEnabled ? '' : 'disabled'}>Arbeitsbeginn</button>
      <button class="habun-v2-danger" type="button" data-clock-action="clock-out" ${controls.clockOutEnabled ? '' : 'disabled'}>Arbeitsende</button>
      <button class="habun-v2-secondary" type="button" data-refresh-state>Aktualisieren</button>
    </div>
    <p class="habun-v2-status" data-v2-status ${model.status?.message ? '' : 'hidden'} data-tone="${model.status?.tone || 'info'}">${model.status?.message || ''}</p>
    ${model.queue.length ? `<p class="habun-v2-status" data-tone="warn">${model.queue.length} Buchung(en) warten auf Synchronisierung.</p>` : ''}
    <p class="habun-v2-status">Der Standort wird ausschließlich nach Tippen auf Arbeitsbeginn oder Arbeitsende abgefragt. Es gibt keine dauerhafte Ortung.</p>
  `
  section.querySelectorAll('[data-clock-action]').forEach((button) => {
    button.addEventListener('click', () => clock(button.dataset.clockAction))
  })
  section.querySelector('[data-refresh-state]')?.addEventListener('click', refreshState)
}

function renderHistory(entries = model.state.events || []) {
  const section = model.panel?.querySelector('[data-section="history"]')
  if (!section) return
  const rows = entries.map((entry) => `
    <tr>
      <td>${entry.action === 'clock-in' ? 'Arbeitsbeginn' : 'Arbeitsende'}</td>
      <td>${formatDateTime(entry.clientOccurredAt)}</td>
      <td><span class="habun-v2-pill ${entry.locationStatus}">${locationLabel(entry.locationStatus)}</span></td>
      <td>${formatDistance(entry.location?.distanceMeters)}</td>
      <td>${entry.offlineCaptured ? 'Offline erfasst' : 'Online'}</td>
    </tr>`).join('')
  section.innerHTML = `
    <div class="habun-v2-fields">
      <label>Von<input type="date" data-history-from></label>
      <label>Bis<input type="date" data-history-to></label>
    </div>
    <div class="habun-v2-actions"><button class="habun-v2-secondary" type="button" data-history-load>Zeitraum anzeigen</button></div>
    <div class="habun-v2-table-wrap"><table class="habun-v2-table"><thead><tr><th>Aktion</th><th>Zeit</th><th>Standort</th><th>Entfernung</th><th>Übertragung</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Keine Buchungen vorhanden.</td></tr>'}</tbody></table></div>
    ${model.role === 'employee' ? '<p class="habun-v2-status">Mitarbeiter können ihre Zeiten hier ansehen. Ein PDF-Download ist nicht verfügbar.</p>' : ''}
  `
  section.querySelector('[data-history-load]')?.addEventListener('click', loadHistory)
}

function renderShell() {
  if (model.panel) return
  const shell = document.createElement('div')
  shell.className = 'habun-v2-shell'
  shell.hidden = true
  shell.innerHTML = `
    <section class="habun-v2-panel" role="dialog" aria-modal="true" aria-labelledby="habun-v2-title">
      <header class="habun-v2-head"><h2 id="habun-v2-title">Zeiterfassung und Planung</h2><button class="habun-v2-close" type="button" aria-label="Schließen">×</button></header>
      <nav class="habun-v2-tabs" aria-label="Portalbereiche">
        <button type="button" data-tab="clock" aria-selected="true">Stempeluhr</button>
        <button type="button" data-tab="history" aria-selected="false">Meine Zeiten</button>
      </nav>
      <main class="habun-v2-body">
        <section class="habun-v2-section" data-section="clock"></section>
        <section class="habun-v2-section" data-section="history" hidden></section>
        <section class="habun-v2-section" data-section="live" hidden></section>
        <section class="habun-v2-section" data-section="schedule" hidden></section>
        <section class="habun-v2-section" data-section="corrections" hidden></section>
        <section class="habun-v2-section" data-section="reports" hidden></section>
      </main>
    </section>`
  document.body.append(shell)
  model.panel = shell
  shell.querySelector('.habun-v2-close')?.addEventListener('click', closePanel)
  shell.addEventListener('click', (event) => { if (event.target === shell) closePanel() })
  shell.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)))
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !shell.hidden) closePanel() })
  renderClock()
  renderHistory()
}

function activateTab(name) {
  model.panel?.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === name)))
  model.panel?.querySelectorAll('[data-section]').forEach((section) => { section.hidden = section.dataset.section !== name })
  window.dispatchEvent(new CustomEvent('habun:v2-tab', { detail: { name, model } }))
}

function openPanel() {
  renderShell()
  model.panel.hidden = false
  document.documentElement.style.overflow = 'hidden'
  refreshState()
}

function closePanel() {
  if (!model.panel) return
  model.panel.hidden = true
  document.documentElement.style.overflow = ''
}

function installLauncher() {
  if (document.querySelector('[data-habun-v2-launch]')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.habunV2Launch = 'true'
  button.className = 'habun-v2-launch'
  button.textContent = 'Neue Zeiterfassung'
  button.addEventListener('click', openPanel)
  const nav = document.querySelector('.sidebar nav, .sidebar-drawer nav')
  if (nav) nav.append(button)
  else {
    button.classList.add('habun-v2-float')
    document.body.append(button)
  }
}

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  })
}

async function refreshSession() {
  try {
    const session = await jsonFetch('/api/session')
    model.role = roleFromSession(session)
    return true
  } catch { return false }
}

async function sendEvent(event, allowRetry = true) {
  try {
    return await jsonFetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch (error) {
    if (allowRetry && shouldRefreshSession(error.status) && await refreshSession()) return sendEvent(event, false)
    throw error
  }
}

async function clock(action) {
  if (model.submitting || model.syncing || !model.restored) return
  if (action === 'clock-out' && !window.confirm('Arbeitszeit jetzt wirklich beenden?')) return
  model.submitting = true
  renderClock()
  status('Standort wird einmalig ermittelt …')
  const location = await requestLocation()
  const event = {
    clientEventId: createClientEventId(),
    action,
    clientOccurredAt: new Date().toISOString(),
    offlineCaptured: !navigator.onLine,
    scheduleId: model.state.schedule?.id || null,
    objectId: model.state.schedule?.objectId || null,
    location,
  }
  try {
    if (!navigator.onLine) throw Object.assign(new Error('OFFLINE'), { offline: true })
    const result = await sendEvent(event)
    model.state = reduceAttendanceState(model.state, { ...event, ...result.event })
    model.state.events = [...(model.state.events || []), { ...result.event, location: result.location }]
    const tone = result.event.locationStatus === 'inside' ? 'good' : 'bad'
    status(`${action === 'clock-in' ? 'Arbeitsbeginn' : 'Arbeitsende'} gespeichert · ${locationLabel(result.event.locationStatus)}`, tone)
  } catch (error) {
    if (error.offline || !navigator.onLine || error instanceof TypeError) {
      model.queue = enqueueAttendanceEvent(model.queue, { ...event, offlineCaptured: true })
      model.state = reduceAttendanceState(model.state, event)
      model.state.events = [...(model.state.events || []), { ...event, locationStatus: 'unavailable' }]
      status('Buchung wurde offline gespeichert und wird später automatisch übertragen.', 'warn')
    } else {
      status(error.message || 'Buchung konnte nicht gespeichert werden.', 'bad')
    }
  } finally {
    model.submitting = false
    saveLocal()
    renderClock()
    renderHistory()
  }
}

async function flushQueue() {
  if (model.syncing || !navigator.onLine || !model.queue.length) return
  model.syncing = true
  renderClock()
  try {
    const pending = sortPendingEvents(model.queue)
    const remaining = []
    for (let index = 0; index < pending.length; index += 1) {
      const event = pending[index]
      try { await sendEvent({ ...event, offlineCaptured: true }) }
      catch (error) {
        if (error.status === 409 && error.code !== 'CLIENT_EVENT_ID_CONFLICT') continue
        remaining.push(event, ...pending.slice(index + 1))
        break
      }
    }
    model.queue = remaining
    saveLocal()
    await refreshState()
    if (!remaining.length) status('Alle Offline-Buchungen wurden synchronisiert.', 'good')
  } finally {
    model.syncing = false
    renderClock()
  }
}

async function refreshState() {
  if (!model.restored) return
  try {
    const payload = await jsonFetch('/api/attendance?resource=state')
    model.state = { ...model.state, ...payload }
    saveLocal()
    status('Aktueller Stand geladen.', 'good')
  } catch (error) {
    if (error.status !== 503) status(error.message || 'Stand konnte nicht geladen werden.', 'bad')
  }
  renderClock()
  renderHistory()
  flushQueue()
}

async function loadHistory() {
  const section = model.panel?.querySelector('[data-section="history"]')
  const from = section?.querySelector('[data-history-from]')?.value || ''
  const to = section?.querySelector('[data-history-to]')?.value || ''
  const query = new URLSearchParams({ resource: 'history' })
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  try {
    const payload = await jsonFetch(`/api/attendance?${query}`)
    renderHistory(payload.entries || [])
  } catch (error) { status(error.message, 'bad') }
}

function addManagementTabs() {
  if (!MANAGEMENT.has(model.role) || !model.panel) return
  const tabs = model.panel.querySelector('.habun-v2-tabs')
  const definitions = [
    ['live', 'Live-Übersicht'],
    ['schedule', 'Dienstplan'],
    ['corrections', 'Korrekturen'],
    ['reports', 'Berichte'],
  ]
  for (const [name, label] of definitions) {
    if (tabs.querySelector(`[data-tab="${name}"]`)) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.tab = name
    button.setAttribute('aria-selected', 'false')
    button.textContent = label
    button.addEventListener('click', () => activateTab(name))
    tabs.append(button)
  }
}

async function init() {
  restoreLocal()
  renderShell()
  await refreshSession()
  addManagementTabs()
  installLauncher()
  const observer = new MutationObserver(installLauncher)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('online', flushQueue)
  window.HabunAttendanceV2 = { model, open: openPanel, close: closePanel, refresh: refreshState, jsonFetch, status, activateTab }
  window.dispatchEvent(new CustomEvent('habun:v2-ready', { detail: window.HabunAttendanceV2 }))
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
else init()
