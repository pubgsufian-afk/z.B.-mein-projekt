const TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])

const uiState = {
  role: null,
  refreshRunning: false,
  refreshQueued: false,
  timer: null,
  observer: null,
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
  if (!response.ok) throw new Error(body.message || `Die Anfrage ist fehlgeschlagen (${response.status}).`)
  return body
}

function isTimesPage() {
  return document.querySelector('.topbar-title h1')?.textContent?.trim() === 'Zeiten'
}

function currentFilters() {
  const panel = document.querySelector('.filter-panel')
  if (!panel) return null
  const dates = [...panel.querySelectorAll('input[type="date"]')]
  return {
    panel,
    from: dates[0]?.value || '',
    to: dates[1]?.value || '',
    userId: panel.querySelector('select')?.value || '',
    reloadButton: [...panel.querySelectorAll('button')].find((button) => String(button.textContent || '').includes('Zeitraum anzeigen')) || null,
  }
}

function finalizeOpenSession(current, sessions) {
  if (!current) return
  current.netMinutes = 0
  current.isOpen = true
  sessions.push(current)
}

function buildSessions(entries) {
  const ordered = [...entries].sort((a, b) => String(a.clientOccurredAt || '').localeCompare(String(b.clientOccurredAt || '')))
  const openByUser = new Map()
  const sessions = []

  for (const event of ordered) {
    const userId = String(event.userId || '')
    if (!userId) continue
    let current = openByUser.get(userId) || null

    if (event.action === 'clock-in') {
      if (current) finalizeOpenSession(current, sessions)
      current = {
        userId,
        date: event.eventDate,
        clockInEventId: event.id,
        clockOutEventId: null,
        clockInAt: event.clientOccurredAt,
        clockOutAt: null,
        breakMinutes: 0,
        breakStart: null,
        isOpen: true,
      }
      openByUser.set(userId, current)
      continue
    }

    if (!current) continue
    if (event.action === 'break-start') {
      current.breakStart = event.clientOccurredAt
      continue
    }
    if (event.action === 'break-end' && current.breakStart) {
      current.breakMinutes += Math.max(0, Math.round((new Date(event.clientOccurredAt) - new Date(current.breakStart)) / 60000))
      current.breakStart = null
      continue
    }
    if (event.action === 'clock-out') {
      current.clockOutEventId = event.id
      current.clockOutAt = event.clientOccurredAt
      current.isOpen = false
      if (event.pauseMinutesAdjustment !== null && event.pauseMinutesAdjustment !== undefined) {
        current.breakMinutes = Math.max(0, Number(event.pauseMinutesAdjustment) || 0)
      }
      const grossMinutes = Math.max(0, Math.round((new Date(current.clockOutAt) - new Date(current.clockInAt)) / 60000))
      current.netMinutes = Math.max(0, grossMinutes - current.breakMinutes)
      sessions.push(current)
      openByUser.delete(userId)
    }
  }

  for (const current of openByUser.values()) finalizeOpenSession(current, sessions)
  return sessions.sort((a, b) => String(a.clockInAt).localeCompare(String(b.clockInAt)))
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  return `${hours}:${String(rest).padStart(2, '0')} Std.`
}

function applyAdjustedValues(cards, sessions) {
  let totalPause = 0
  let totalNet = 0
  cards.forEach((card, index) => {
    const session = sessions[index]
    if (!session) return
    totalPause += Number(session.breakMinutes || 0)
    totalNet += Number(session.netMinutes || 0)
    const values = [...card.querySelectorAll('.time-values > div')]
    const pauseValue = values.find((node) => node.querySelector('span')?.textContent?.trim() === 'Pause')?.querySelector('strong')
    const netValue = values.find((node) => node.querySelector('span')?.textContent?.trim() === 'Netto')?.querySelector('strong')
    if (pauseValue) pauseValue.textContent = `${Number(session.breakMinutes || 0)} Min.`
    if (netValue) netValue.textContent = formatDuration(session.netMinutes)
  })

  const metrics = [...document.querySelectorAll('.metric-strip.compact-metrics > div')]
  const pauseMetric = metrics.find((node) => node.querySelector('span')?.textContent?.trim() === 'Pausen')?.querySelector('strong')
  const totalMetric = metrics.find((node) => node.querySelector('span')?.textContent?.trim() === 'Gesamt')?.querySelector('strong')
  if (pauseMetric) pauseMetric.textContent = formatDuration(totalPause)
  if (totalMetric) totalMetric.textContent = formatDuration(totalNet)
}

function toLocalInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function showToast(message, tone = 'success') {
  document.querySelector('[data-admin-time-toast]')?.remove()
  const toast = document.createElement('div')
  toast.dataset.adminTimeToast = 'true'
  toast.setAttribute('role', 'status')
  toast.textContent = message
  Object.assign(toast.style, {
    position: 'fixed',
    zIndex: '10000',
    left: '16px',
    right: '16px',
    bottom: '20px',
    maxWidth: '620px',
    margin: '0 auto',
    padding: '14px 18px',
    borderRadius: '14px',
    background: tone === 'error' ? '#451d1d' : '#173c2b',
    color: '#fff',
    fontWeight: '700',
    boxShadow: '0 12px 32px rgba(0,0,0,.35)',
  })
  document.body.append(toast)
  window.setTimeout(() => toast.remove(), 5000)
}

function removeEditor() {
  document.querySelector('[data-admin-time-editor]')?.remove()
}

function invalidateRenderedSessions() {
  document.querySelectorAll('.times-list > article').forEach((card) => {
    delete card.dataset.adminTimeEditChecked
  })
}

function openEditor(session, reloadButton) {
  removeEditor()
  const timesPanel = document.querySelector('.times-list')?.closest('.panel')
  if (!timesPanel) return
  const openSession = !session.clockOutEventId

  const editor = document.createElement('section')
  editor.dataset.adminTimeEditor = 'true'
  editor.className = 'panel editor-panel'
  editor.innerHTML = `
    <div class="page-heading">
      <div><h2>Arbeitszeit bearbeiten</h2><p>${openSession ? 'Der Mitarbeiter ist aktuell eingecheckt. Beginn kann sofort korrigiert werden; mit einem Arbeitsende können auch Ende und Pause festgelegt werden.' : 'Änderungen werden im Kontrollverlauf protokolliert.'}</p></div>
      <button type="button" class="secondary-button compact" data-admin-time-close>Schließen</button>
    </div>
    <form class="schedule-form" data-admin-time-form>
      <div class="form-grid three">
        <label>Beginn<input type="datetime-local" data-admin-time-start required></label>
        <label>Ende<input type="datetime-local" data-admin-time-end ${openSession ? '' : 'required'}><small>${openSession ? 'Leer lassen, wenn der Mitarbeiter weiterarbeitet.' : 'Bei abgeschlossenem Dienst erforderlich.'}</small></label>
        <label>Pause in Minuten<input type="number" min="0" step="1" data-admin-time-pause required><small data-admin-time-pause-help></small></label>
      </div>
      <label>Begründung<textarea rows="3" data-admin-time-reason required placeholder="Warum wird die Arbeitszeit geändert?"></textarea></label>
      <div class="form-actions">
        <button class="primary-button" data-admin-time-save>Änderung speichern</button>
        <button type="button" class="secondary-button" data-admin-time-cancel>Abbrechen</button>
      </div>
    </form>`

  const start = editor.querySelector('[data-admin-time-start]')
  const end = editor.querySelector('[data-admin-time-end]')
  const pause = editor.querySelector('[data-admin-time-pause]')
  const pauseHelp = editor.querySelector('[data-admin-time-pause-help]')
  const reason = editor.querySelector('[data-admin-time-reason]')
  start.value = toLocalInput(session.clockInAt)
  end.value = toLocalInput(session.clockOutAt)
  pause.value = String(session.breakMinutes || 0)

  const syncOpenControls = () => {
    if (!openSession) {
      pause.readOnly = false
      if (pauseHelp) pauseHelp.textContent = ''
      return
    }
    const willClose = Boolean(end.value)
    pause.readOnly = !willClose
    if (pauseHelp) {
      pauseHelp.textContent = willClose
        ? 'Pause kann jetzt vollständig korrigiert werden.'
        : 'Solange der Dienst offen bleibt, wird die bereits gebuchte Pause beibehalten.'
    }
  }
  end.addEventListener('input', syncOpenControls)
  syncOpenControls()

  editor.querySelector('[data-admin-time-close]').addEventListener('click', removeEditor)
  editor.querySelector('[data-admin-time-cancel]').addEventListener('click', removeEditor)
  editor.querySelector('[data-admin-time-form]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const saveButton = editor.querySelector('[data-admin-time-save]')
    saveButton.disabled = true
    saveButton.textContent = 'Wird gespeichert …'
    try {
      const clockInAt = new Date(start.value)
      const clockOutAt = end.value ? new Date(end.value) : null
      const pauseMinutes = Number(pause.value)
      if (!Number.isFinite(clockInAt.getTime())) throw new Error('Der Arbeitsbeginn ist ungültig.')
      if (!openSession && (!clockOutAt || !Number.isFinite(clockOutAt.getTime()))) throw new Error('Bei einem abgeschlossenen Dienst ist ein gültiges Arbeitsende erforderlich.')
      if (clockOutAt && !Number.isFinite(clockOutAt.getTime())) throw new Error('Das Arbeitsende ist ungültig.')
      if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) throw new Error('Die Pause muss eine ganze Minute ab 0 sein.')
      if (clockOutAt && clockOutAt.getTime() <= clockInAt.getTime()) throw new Error('Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.')
      if (clockOutAt) {
        const grossMinutes = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000)
        if (pauseMinutes > grossMinutes) throw new Error('Die Pause darf nicht länger als die Arbeitszeit sein.')
      } else if (openSession && pauseMinutes !== Number(session.breakMinutes || 0)) {
        throw new Error('Für eine Pausenkorrektur bei einem laufenden Dienst bitte zuerst ein Arbeitsende eintragen.')
      }
      if (reason.value.trim().length < 2) throw new Error('Bitte eine kurze Begründung eintragen.')

      await fetch('/api/attendance-time-edit', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clockInEventId: session.clockInEventId,
          clockOutEventId: session.clockOutEventId || null,
          clockInAt: clockInAt.toISOString(),
          clockOutAt: clockOutAt ? clockOutAt.toISOString() : null,
          pauseMinutes,
          reason: reason.value.trim(),
        }),
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.message || `Die Änderung ist fehlgeschlagen (${response.status}).`)
        return body
      })

      removeEditor()
      showToast(openSession && clockOutAt
        ? 'Laufender Dienst wurde korrigiert und abgeschlossen.'
        : 'Arbeitszeit wurde aktualisiert und im Kontrollverlauf protokolliert.')
      invalidateRenderedSessions()
      reloadButton?.click()
      scheduleRefresh(350)
    } catch (error) {
      showToast(error.message || 'Die Arbeitszeit konnte nicht geändert werden.', 'error')
    } finally {
      saveButton.disabled = false
      saveButton.textContent = 'Änderung speichern'
    }
  })

  timesPanel.before(editor)
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function removeHint() {
  document.querySelector('[data-admin-time-hint]')?.remove()
}

function showSelectEmployeeHint(timesPanel) {
  if (document.querySelector('[data-admin-time-hint]')) return
  const hint = document.createElement('p')
  hint.dataset.adminTimeHint = 'true'
  hint.className = 'notice notice-info'
  hint.textContent = 'Zum sicheren Bearbeiten bitte zuerst einen einzelnen Mitarbeiter auswählen.'
  timesPanel.querySelector('.page-heading')?.insertAdjacentElement('afterend', hint)
}

async function ensureRole() {
  if (uiState.role) return uiState.role
  try {
    const session = await jsonFetch('/api/session')
    uiState.role = String(session.role || '')
  } catch {
    uiState.role = null
  }
  return uiState.role
}

async function refreshButtons() {
  if (uiState.refreshRunning) {
    uiState.refreshQueued = true
    return
  }
  uiState.refreshRunning = true
  try {
    if (!isTimesPage()) {
      uiState.role = null
      removeEditor()
      removeHint()
      return
    }

    const role = await ensureRole()
    if (role === 'employee' || role === 'pending') return
    const canEdit = TIME_EDIT_ROLES.has(role)
    if (!canEdit) return

    const filters = currentFilters()
    const cards = [...document.querySelectorAll('.times-list > article')]
    if (!filters || !filters.from || !filters.to || !cards.length) return
    if (cards.every((card) => card.dataset.adminTimeEditChecked === `${filters.from}|${filters.to}|${filters.userId}`)) return

    const params = new URLSearchParams({ resource: 'history', from: filters.from, to: filters.to })
    if (filters.userId) params.set('userId', filters.userId)
    const data = await jsonFetch(`/api/attendance?${params}`)
    const entries = Array.isArray(data.entries) ? data.entries : []
    const userIds = new Set(entries.map((entry) => String(entry.userId || '')).filter(Boolean))
    const timesPanel = document.querySelector('.times-list')?.closest('.panel')
    const key = `${filters.from}|${filters.to}|${filters.userId}`

    document.querySelectorAll('[data-admin-time-edit]').forEach((button) => button.remove())
    cards.forEach((card) => { card.dataset.adminTimeEditChecked = key })

    if (!filters.userId && userIds.size > 1) {
      if (timesPanel) showSelectEmployeeHint(timesPanel)
      return
    }
    removeHint()

    const sessions = buildSessions(entries)
    applyAdjustedValues(cards, sessions)

    cards.forEach((card, index) => {
      const session = sessions[index]
      if (!session?.clockInEventId) return
      const header = card.querySelector('header')
      if (!header) return
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.adminTimeEdit = 'true'
      button.className = 'secondary-button compact'
      button.textContent = 'Bearbeiten'
      button.addEventListener('click', () => openEditor(session, filters.reloadButton))
      header.append(button)
    })
  } catch (error) {
    console.error('Habun Zeitbearbeitung', error)
  } finally {
    uiState.refreshRunning = false
    if (uiState.refreshQueued) {
      uiState.refreshQueued = false
      scheduleRefresh(150)
    }
  }
}

function scheduleRefresh(delay = 120) {
  if (uiState.timer) window.clearTimeout(uiState.timer)
  uiState.timer = window.setTimeout(() => {
    uiState.timer = null
    refreshButtons()
  }, delay)
}

export function installAdminTimeEditing() {
  if (uiState.observer) return
  uiState.observer = new MutationObserver(() => scheduleRefresh())
  uiState.observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('change', (event) => {
    if (event.target.closest?.('.filter-panel')) scheduleRefresh(100)
  }, true)
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button')
    if (button && String(button.textContent || '').includes('Zeitraum anzeigen')) scheduleRefresh(350)
  }, true)
  scheduleRefresh(0)
}