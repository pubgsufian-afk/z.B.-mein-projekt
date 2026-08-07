const RELEASE = '2026-08-07-3'
const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

let role = null
let roleCheckedAt = 0
let refreshTimer = 0
let requestSerial = 0
let dialog = null

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || `Anfrage fehlgeschlagen (${response.status}).`)
  return body
}

async function managementRole() {
  const now = Date.now()
  if (role && now - roleCheckedAt < 30000) return role
  try {
    const session = await apiJson('/api/session')
    role = String(session?.role || '').trim().toLowerCase()
    roleCheckedAt = now
  } catch {
    role = null
    roleCheckedAt = now
  }
  return role
}

function timeValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value || '00'
  const minute = parts.find((part) => part.type === 'minute')?.value || '00'
  return `${hour}:${minute}`
}

function dateValue(value, fallback = '') {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function timezoneOffsetMillis(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0)
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return asUtc - date.getTime()
}

function berlinDateTime(dateText, timeText, addDay = false) {
  const [year, month, day] = String(dateText || '').split('-').map(Number)
  const [hour, minute] = String(timeText || '').split(':').map(Number)
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Datum und Uhrzeit sind unvollständig.')
  const dayDate = new Date(Date.UTC(year, month - 1, day + (addDay ? 1 : 0), hour, minute, 0))
  const firstOffset = timezoneOffsetMillis(dayDate, 'Europe/Berlin')
  let result = new Date(dayDate.getTime() - firstOffset)
  const secondOffset = timezoneOffsetMillis(result, 'Europe/Berlin')
  if (secondOffset !== firstOffset) result = new Date(dayDate.getTime() - secondOffset)
  if (!Number.isFinite(result.getTime())) throw new Error('Datum oder Uhrzeit ist ungültig.')
  return result
}

function buildSessions(entries) {
  const ordered = [...(Array.isArray(entries) ? entries : [])]
    .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))
  const sessions = []
  let current = null
  let breakStart = null

  for (const event of ordered) {
    if (event.action === 'clock-in') {
      current = {
        date: event.eventDate || dateValue(event.clientOccurredAt),
        clockInAt: event.clientOccurredAt,
        clockOutAt: null,
        clockInEventId: event.id,
        clockOutEventId: null,
        pauseMinutes: 0,
      }
      breakStart = null
    } else if (event.action === 'break-start' && current) {
      breakStart = event
    } else if (event.action === 'break-end' && current && breakStart) {
      current.pauseMinutes += Math.max(0, Math.round((new Date(event.clientOccurredAt) - new Date(breakStart.clientOccurredAt)) / 60000))
      breakStart = null
    } else if (event.action === 'clock-out' && current) {
      current.clockOutAt = event.clientOccurredAt
      current.clockOutEventId = event.id
      sessions.push(current)
      current = null
      breakStart = null
    }
  }
  if (current) sessions.push(current)
  return sessions
}

function timesContext() {
  const list = document.querySelector('.times-list')
  if (!list) return null
  const panel = list.closest('section.panel')
  if (!panel) return null
  const heading = panel.querySelector('.page-heading h2')?.textContent?.trim()
  if (heading !== 'Meine Zeiten') return null

  const filterPanel = [...document.querySelectorAll('section.filter-panel')].find((candidate) => {
    const grid = candidate.querySelector('.filter-grid')
    return grid && grid.querySelectorAll('input[type="date"]').length >= 2 && grid.querySelector('select')
  })
  if (!filterPanel) return null
  const dates = [...filterPanel.querySelectorAll('input[type="date"]')]
  const select = filterPanel.querySelector('select')
  const button = [...filterPanel.querySelectorAll('button')].find((item) => item.textContent?.includes('Zeitraum anzeigen'))
  return {
    list,
    panel,
    from: dates[0]?.value || '',
    to: dates[1]?.value || '',
    userId: select?.value || '',
    employeeName: select?.selectedOptions?.[0]?.textContent?.trim() || 'Mitarbeiter',
    reloadButton: button || null,
  }
}

function removeEditButtons(context) {
  context?.list?.querySelectorAll('[data-admin-attendance-edit]').forEach((node) => node.remove())
}

function removeSelectionHint(context) {
  context?.panel?.querySelectorAll('[data-admin-attendance-hint]').forEach((node) => node.remove())
}

function removeEditorArtifacts(context) {
  removeEditButtons(context)
  removeSelectionHint(context)
}

function showSelectionHint(context) {
  if (context.panel.querySelector('[data-admin-attendance-hint]')) return
  const hint = document.createElement('p')
  hint.dataset.adminAttendanceHint = RELEASE
  hint.className = 'habun-attendance-edit-hint'
  hint.textContent = 'Zum Bearbeiten bitte oben einen einzelnen Mitarbeiter auswählen.'
  context.panel.querySelector('.page-heading')?.insertAdjacentElement('afterend', hint)
}

function ensureStyles() {
  if (document.getElementById('habun-attendance-editor-styles')) return
  const style = document.createElement('style')
  style.id = 'habun-attendance-editor-styles'
  style.textContent = `
    .habun-attendance-edit-row{display:flex;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
    .habun-attendance-edit-button{appearance:none;border:1px solid rgba(222,173,54,.55);background:rgba(222,173,54,.10);color:#f0c75e;border-radius:12px;padding:10px 15px;font:inherit;font-weight:800;cursor:pointer}
    .habun-attendance-edit-button:active{transform:translateY(1px)}
    .habun-attendance-edit-hint{margin:0 0 16px;padding:12px 14px;border:1px solid rgba(222,173,54,.28);border-radius:12px;color:#c8cbd0;background:rgba(222,173,54,.06);font-size:.92rem}
    .habun-attendance-edit-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;padding:18px env(safe-area-inset-right) calc(18px + env(safe-area-inset-bottom)) env(safe-area-inset-left)}
    .habun-attendance-edit-dialog{width:min(620px,calc(100vw - 24px));max-height:92vh;overflow:auto;background:#101416;border:1px solid #333a3e;border-radius:22px 22px 16px 16px;box-shadow:0 28px 70px rgba(0,0,0,.55);color:#f5f6f7;padding:20px}
    .habun-attendance-edit-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}.habun-attendance-edit-head h2{font-size:1.25rem;margin:0 0 5px}.habun-attendance-edit-head p{margin:0;color:#aeb4ba;font-size:.9rem}
    .habun-attendance-edit-close{appearance:none;border:0;background:#20272b;color:#fff;width:38px;height:38px;border-radius:12px;font-size:24px;line-height:1;cursor:pointer}
    .habun-attendance-edit-form{display:grid;gap:14px}.habun-attendance-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.habun-attendance-edit-form label{display:grid;gap:7px;color:#cbd0d4;font-weight:700;font-size:.9rem}
    .habun-attendance-edit-form input,.habun-attendance-edit-form textarea{width:100%;box-sizing:border-box;border:1px solid #374147;border-radius:12px;background:#090c0e;color:#fff;padding:12px;font:inherit}.habun-attendance-edit-form textarea{resize:vertical;min-height:76px}
    .habun-attendance-edit-status{margin:0;padding:10px 12px;border-radius:10px;background:#161d21;color:#cbd0d4}.habun-attendance-edit-status[data-tone="error"]{border:1px solid rgba(229,83,83,.5);color:#ffb0b0}.habun-attendance-edit-status[data-tone="success"]{border:1px solid rgba(61,188,122,.45);color:#b9f0ce}
    .habun-attendance-edit-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}.habun-attendance-edit-actions button{appearance:none;border-radius:12px;padding:12px 16px;font:inherit;font-weight:800;cursor:pointer}.habun-attendance-edit-save{border:0;background:#e1b844;color:#111}.habun-attendance-edit-cancel{border:1px solid #3b4449;background:#171d20;color:#fff}.habun-attendance-edit-actions button:disabled{opacity:.55;cursor:wait}
    @media (min-width:700px){.habun-attendance-edit-backdrop{align-items:center}.habun-attendance-edit-dialog{border-radius:20px}}
    @media (max-width:480px){.habun-attendance-edit-grid{grid-template-columns:1fr}.habun-attendance-edit-dialog{padding:17px}.habun-attendance-edit-actions{display:grid;grid-template-columns:1fr}.habun-attendance-edit-actions button{width:100%}}
  `
  document.head.append(style)
}

function closeDialog() {
  if (!dialog) return
  dialog.remove()
  dialog = null
  document.documentElement.style.overflow = ''
}

function openDialog(session, context) {
  closeDialog()
  ensureStyles()
  const completed = Boolean(session.clockOutAt)
  const start = timeValue(session.clockInAt)
  const end = timeValue(session.clockOutAt)
  const wrapper = document.createElement('div')
  wrapper.className = 'habun-attendance-edit-backdrop'
  wrapper.setAttribute('role', 'presentation')
  wrapper.innerHTML = `
    <section class="habun-attendance-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="habun-attendance-edit-title">
      <header class="habun-attendance-edit-head">
        <div><h2 id="habun-attendance-edit-title">Arbeitszeit bearbeiten</h2><p>${context.employeeName.replace(/[<>]/g, '')}</p></div>
        <button type="button" class="habun-attendance-edit-close" aria-label="Schließen">×</button>
      </header>
      <form class="habun-attendance-edit-form">
        <div class="habun-attendance-edit-grid">
          <label>Datum<input name="date" type="date" value="${dateValue(session.date, dateValue(session.clockInAt))}" required></label>
          <label>Pause in Minuten<input name="pauseMinutes" type="number" min="0" step="1" value="${Number(session.pauseMinutes || 0)}" required></label>
          <label>Arbeitsbeginn<input name="start" type="time" value="${start}" required></label>
          <label>Arbeitsende<input name="end" type="time" value="${end}" ${completed ? 'required' : ''}><small>${completed ? 'Der abgeschlossene Dienst braucht ein Arbeitsende.' : 'Leer lassen, wenn der Mitarbeiter noch arbeitet.'}</small></label>
        </div>
        <label>Änderungsnotiz <span style="font-weight:400;color:#8f989e">optional</span><textarea name="reason" maxlength="1000" placeholder="z. B. falsche Pause oder falsche Uhrzeit"></textarea></label>
        <p class="habun-attendance-edit-status" hidden></p>
        <div class="habun-attendance-edit-actions">
          <button type="button" class="habun-attendance-edit-cancel">Abbrechen</button>
          <button type="submit" class="habun-attendance-edit-save">Änderungen speichern</button>
        </div>
      </form>
    </section>`
  document.body.append(wrapper)
  dialog = wrapper
  document.documentElement.style.overflow = 'hidden'

  const form = wrapper.querySelector('form')
  const status = wrapper.querySelector('.habun-attendance-edit-status')
  const close = () => closeDialog()
  wrapper.querySelector('.habun-attendance-edit-close')?.addEventListener('click', close)
  wrapper.querySelector('.habun-attendance-edit-cancel')?.addEventListener('click', close)
  wrapper.addEventListener('click', (event) => { if (event.target === wrapper) close() })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const fields = new FormData(form)
    const date = String(fields.get('date') || '')
    const startTime = String(fields.get('start') || '')
    const endTime = String(fields.get('end') || '')
    const pauseMinutes = Number(fields.get('pauseMinutes'))
    const reason = String(fields.get('reason') || '').trim()

    if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) {
      status.hidden = false
      status.dataset.tone = 'error'
      status.textContent = 'Die Pause muss als ganze Minute ab 0 eingetragen werden.'
      return
    }

    let clockInAt
    let clockOutAt = null
    try {
      clockInAt = berlinDateTime(date, startTime)
      if (endTime) {
        const addDay = endTime <= startTime
        clockOutAt = berlinDateTime(date, endTime, addDay)
      }
    } catch (error) {
      status.hidden = false
      status.dataset.tone = 'error'
      status.textContent = error.message || 'Datum oder Uhrzeit ist ungültig.'
      return
    }

    if (completed && !clockOutAt) {
      status.hidden = false
      status.dataset.tone = 'error'
      status.textContent = 'Bei einem abgeschlossenen Dienst muss ein Arbeitsende eingetragen sein.'
      return
    }
    if (clockOutAt && clockOutAt <= clockInAt) {
      status.hidden = false
      status.dataset.tone = 'error'
      status.textContent = 'Arbeitsende muss nach dem Arbeitsbeginn liegen.'
      return
    }
    if (!window.confirm('Diese Arbeitszeit wirklich ändern? Die Änderung wird im Kontrollverlauf gespeichert.')) return

    const save = wrapper.querySelector('.habun-attendance-edit-save')
    save.disabled = true
    save.textContent = 'Wird gespeichert …'
    status.hidden = false
    status.dataset.tone = 'info'
    status.textContent = 'Arbeitszeit wird gespeichert …'
    try {
      await apiJson('/api/attendance-edit', {
        method: 'POST',
        body: JSON.stringify({
          action: 'edit-session',
          userId: context.userId,
          clockInEventId: session.clockInEventId,
          clockOutEventId: session.clockOutEventId || null,
          clockInAt: clockInAt.toISOString(),
          clockOutAt: clockOutAt?.toISOString() || null,
          pauseMinutes,
          reason,
        }),
      })
      status.dataset.tone = 'success'
      status.textContent = 'Arbeitszeit wurde korrigiert.'
      window.setTimeout(() => {
        closeDialog()
        if (context.reloadButton?.isConnected) context.reloadButton.click()
        else scheduleEnhance(100)
      }, 350)
    } catch (error) {
      status.dataset.tone = 'error'
      status.textContent = error.message || 'Die Arbeitszeit konnte nicht gespeichert werden.'
      save.disabled = false
      save.textContent = 'Änderungen speichern'
    }
  })
}

async function enhanceTimes() {
  const context = timesContext()
  if (!context) return
  const currentRole = await managementRole()
  if (!MANAGEMENT.has(currentRole)) {
    removeEditorArtifacts(context)
    return
  }
  ensureStyles()
  if (!context.userId) {
    removeEditButtons(context)
    showSelectionHint(context)
    return
  }
  removeSelectionHint(context)
  if (!context.from || !context.to) return

  const serial = ++requestSerial
  try {
    const params = new URLSearchParams({ resource: 'history', from: context.from, to: context.to, userId: context.userId })
    const data = await apiJson(`/api/attendance?${params}`)
    if (serial !== requestSerial) return
    const sessions = buildSessions(data.entries || [])
    const cards = [...context.list.querySelectorAll(':scope > article')]
    cards.forEach((card, index) => {
      const session = sessions[index]
      const existing = card.querySelector('[data-admin-attendance-edit]')
      if (!session?.clockInEventId) {
        existing?.remove()
        return
      }
      if (existing?.dataset.sessionId === session.clockInEventId && existing.dataset.adminAttendanceEdit === RELEASE) return
      existing?.remove()
      const row = document.createElement('div')
      row.className = 'habun-attendance-edit-row'
      row.dataset.adminAttendanceEdit = RELEASE
      row.dataset.sessionId = session.clockInEventId
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'habun-attendance-edit-button'
      button.textContent = 'Bearbeiten'
      button.addEventListener('click', () => openDialog(session, context))
      row.append(button)
      card.append(row)
    })
  } catch (error) {
    console.error('Habun attendance editor', error)
  }
}

function scheduleEnhance(delay = 80) {
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(enhanceTimes, delay)
}

function boot() {
  scheduleEnhance(0)
  const observer = new MutationObserver(() => scheduleEnhance())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', () => scheduleEnhance(50))
  window.__HABUN_ATTENDANCE_EDITOR_RELEASE__ = RELEASE
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()
