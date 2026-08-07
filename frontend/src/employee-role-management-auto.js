const ROLE_LABELS = {
  owner: 'Chef / Hauptadmin',
  admin: 'Admin',
  manager: 'Einsatzleiter',
  employee: 'Mitarbeiter',
}

const state = {
  role: null,
  timer: null,
  running: false,
  queued: false,
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

function isEmployeesPage() {
  return document.querySelector('.topbar-title h1')?.textContent?.trim() === 'Mitarbeiter'
}

function installStyles() {
  if (document.querySelector('[data-employee-role-styles]')) return
  const style = document.createElement('style')
  style.dataset.employeeRoleStyles = 'true'
  style.textContent = `
    .employee-role-management { display:grid; gap:10px; margin-top:4px; padding-top:12px; border-top:1px solid var(--border-soft); }
    .employee-role-current { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .employee-role-current > span:first-child { color:var(--muted); font-size:12px; font-weight:700; }
    .employee-role-management .employee-actions { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }
    .employee-role-management .employee-actions select { width:100%; min-width:0; }
    .employee-role-protected { color:var(--muted); font-size:12px; line-height:1.4; }
    @media (max-width:680px) {
      .employee-role-management .employee-actions { grid-template-columns:1fr; }
      .employee-role-management .employee-actions button { width:100%; }
    }
  `
  document.head.append(style)
}

function showToast(message, tone = 'success') {
  document.querySelector('[data-employee-role-toast]')?.remove()
  const toast = document.createElement('div')
  toast.dataset.employeeRoleToast = 'true'
  toast.setAttribute('role', 'status')
  toast.textContent = message
  Object.assign(toast.style, {
    position: 'fixed', zIndex: '10000', left: '16px', right: '16px', bottom: '20px',
    maxWidth: '620px', margin: '0 auto', padding: '14px 18px', borderRadius: '14px',
    background: tone === 'error' ? '#451d1d' : '#173c2b', color: '#fff', fontWeight: '700',
    boxShadow: '0 12px 32px rgba(0,0,0,.35)',
  })
  document.body.append(toast)
  window.setTimeout(() => toast.remove(), 4500)
}

async function ensureRole() {
  if (state.role) return state.role
  const session = await jsonFetch('/api/session')
  state.role = String(session.role || '')
  return state.role
}

function clearInjected() {
  document.querySelectorAll('[data-employee-role-management]').forEach((node) => node.remove())
}

function findEmployeeForCard(card, employees, index) {
  const name = card.querySelector('strong')?.textContent?.trim() || ''
  return employees.find((employee) => String(employee.fullName || '').trim() === name) || employees[index] || null
}

function buildRoleEditor(card, employee, actorRole, refresh) {
  const currentRole = String(employee.role || 'employee')
  const targetId = String(employee.userId || employee.id || '')
  if (!targetId) return

  const wrap = document.createElement('div')
  wrap.dataset.employeeRoleManagement = 'true'
  wrap.className = 'employee-role-management'

  const current = document.createElement('div')
  current.className = 'employee-role-current'
  const label = document.createElement('span')
  label.textContent = 'Rolle'
  const badge = document.createElement('span')
  badge.className = `status ${['owner', 'admin', 'manager'].includes(currentRole) ? 'status-gold' : 'status-neutral'}`
  badge.textContent = ROLE_LABELS[currentRole] || 'Mitarbeiter'
  current.append(label, badge)
  wrap.append(current)

  const canManage = actorRole === 'owner' || actorRole === 'admin'
  const protectedTarget = currentRole === 'owner' || (actorRole !== 'owner' && currentRole === 'admin')
  if (!canManage || protectedTarget) {
    const info = document.createElement('span')
    info.className = 'employee-role-protected'
    info.textContent = currentRole === 'owner' ? 'Hauptadmin ist geschützt.' : actorRole === 'admin' && currentRole === 'admin' ? 'Nur Hauptadmin darf Admin-Konten ändern.' : 'Keine Berechtigung zum Ändern.'
    wrap.append(info)
    card.append(wrap)
    return
  }

  const actions = document.createElement('div')
  actions.className = 'employee-actions'
  const select = document.createElement('select')
  select.setAttribute('aria-label', `Rolle für ${employee.fullName || 'Mitarbeiter'}`)
  const options = [
    ['employee', 'Mitarbeiter'],
    ['manager', 'Einsatzleiter'],
    ...(actorRole === 'owner' ? [['admin', 'Admin']] : []),
  ]
  for (const [value, text] of options) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    select.append(option)
  }
  select.value = options.some(([value]) => value === currentRole) ? currentRole : 'employee'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'primary-button compact'
  button.textContent = 'Rolle ändern'
  button.addEventListener('click', async () => {
    button.disabled = true
    select.disabled = true
    const oldText = button.textContent
    button.textContent = 'Wird gespeichert …'
    try {
      await jsonFetch('/api/registrations', {
        method: 'PATCH',
        body: JSON.stringify({ id: targetId, action: 'update-role', role: select.value }),
      })
      showToast(`${employee.fullName || 'Mitarbeiter'} ist jetzt ${ROLE_LABELS[select.value] || select.value}.`)
      await refresh()
    } catch (error) {
      showToast(error.message || 'Die Rolle konnte nicht geändert werden.', 'error')
    } finally {
      button.disabled = false
      select.disabled = false
      button.textContent = oldText
    }
  })
  actions.append(select, button)
  wrap.append(actions)
  card.append(wrap)
}

async function refreshRoleEditors() {
  if (state.running) {
    state.queued = true
    return
  }
  state.running = true
  try {
    if (!isEmployeesPage()) {
      state.role = null
      clearInjected()
      return
    }
    installStyles()
    const actorRole = await ensureRole()
    if (!['owner', 'admin', 'manager'].includes(actorRole)) return

    const grid = document.querySelector('.employee-grid')
    const cards = [...document.querySelectorAll('.employee-grid article')]
    if (!grid || !cards.length) return

    const data = await jsonFetch('/api/registrations')
    const employees = Array.isArray(data.employees) ? data.employees : []
    clearInjected()
    cards.forEach((card, index) => {
      const employee = findEmployeeForCard(card, employees, index)
      if (employee) buildRoleEditor(card, employee, actorRole, refreshRoleEditors)
    })
  } catch (error) {
    console.error('Habun Mitarbeiterrollen', error)
  } finally {
    state.running = false
    if (state.queued) {
      state.queued = false
      scheduleRefresh(150)
    }
  }
}

function scheduleRefresh(delay = 120) {
  if (state.timer) window.clearTimeout(state.timer)
  state.timer = window.setTimeout(() => {
    state.timer = null
    refreshRoleEditors()
  }, delay)
}

export function installEmployeeRoleManagement() {
  if (state.observer) return
  state.observer = new MutationObserver(() => scheduleRefresh())
  state.observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button')
    if (button && String(button.textContent || '').includes('Aktualisieren')) scheduleRefresh(300)
  }, true)
  scheduleRefresh(0)
}

installEmployeeRoleManagement()
