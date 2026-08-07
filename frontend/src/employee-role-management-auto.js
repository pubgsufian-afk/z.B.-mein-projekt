const LABELS = {
  owner: 'Chef / Hauptadmin',
  admin: 'Admin',
  manager: 'Einsatzleiter',
  employee: 'Mitarbeiter',
}

let cachedSession = null
let timer = 0
let running = false
let queued = false
let observer = null

async function api(path, options = {}) {
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
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
  if (!response.ok) throw new Error(body.message || `Anfrage fehlgeschlagen (${response.status}).`)
  return body
}

function onPage() {
  return document.querySelector('.topbar-title h1')?.textContent?.trim() === 'Mitarbeiter'
}

function clearInjected() {
  document.querySelectorAll('[data-employee-role-management]').forEach((node) => node.remove())
}

function installStyles() {
  if (document.querySelector('[data-employee-role-styles]')) return
  const style = document.createElement('style')
  style.dataset.employeeRoleStyles = 'true'
  style.textContent = `
    .employee-role-management{display:grid;gap:10px;margin-top:8px;padding-top:12px;border-top:1px solid var(--border-soft)}
    .employee-role-line{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .employee-role-management .employee-actions{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px}
    .employee-role-note{font-size:12px;color:var(--muted)}
    @media(max-width:680px){.employee-role-management .employee-actions{grid-template-columns:1fr}.employee-role-management button{width:100%}}
  `
  document.head.append(style)
}

function toast(text, error = false) {
  document.querySelector('[data-employee-role-toast]')?.remove()
  const node = document.createElement('div')
  node.dataset.employeeRoleToast = 'true'
  node.textContent = text
  Object.assign(node.style, {
    position: 'fixed', zIndex: 10000, left: '16px', right: '16px', bottom: '20px',
    maxWidth: '620px', margin: 'auto', padding: '14px 18px', borderRadius: '14px',
    background: error ? '#451d1d' : '#173c2b', color: '#fff', fontWeight: '700',
  })
  document.body.append(node)
  setTimeout(() => node.remove(), 4500)
}

async function session() {
  if (cachedSession) return cachedSession
  const current = await api('/api/session')
  cachedSession = { role: String(current.role || ''), userId: String(current.userId || current.id || '') }
  return cachedSession
}

function employeeFor(card, employees, index) {
  const name = card.querySelector('strong')?.textContent?.trim() || ''
  return employees.find((employee) => String(employee.fullName || '').trim() === name) || employees[index] || null
}

function addEditor(card, employee, currentSession, refresh) {
  const role = String(employee.role || 'employee')
  const id = String(employee.userId || employee.id || '')
  if (!id) return

  const wrapper = document.createElement('div')
  wrapper.dataset.employeeRoleManagement = 'true'
  wrapper.className = 'employee-role-management'

  const line = document.createElement('div')
  line.className = 'employee-role-line'
  const roleLabel = document.createElement('span')
  roleLabel.textContent = 'Rolle'
  const badge = document.createElement('span')
  badge.className = 'status status-gold'
  badge.textContent = LABELS[role] || 'Mitarbeiter'
  line.append(roleLabel, badge)
  wrapper.append(line)

  const selfOwner = currentSession.role === 'owner' && id === currentSession.userId
  const protectedTarget = role === 'owner' || selfOwner || (currentSession.role === 'admin' && role === 'admin')
  const canManage = currentSession.role === 'owner' || currentSession.role === 'admin'
  if (!canManage || protectedTarget) {
    const note = document.createElement('span')
    note.className = 'employee-role-note'
    note.textContent = role === 'owner' || selfOwner
      ? 'Hauptadmin ist geschützt.'
      : currentSession.role === 'admin' && role === 'admin'
        ? 'Nur Hauptadmin darf Admin-Konten ändern.'
        : 'Keine Berechtigung zum Ändern.'
    wrapper.append(note)
    card.append(wrapper)
    return
  }

  const actions = document.createElement('div')
  actions.className = 'employee-actions'
  const select = document.createElement('select')
  select.setAttribute('aria-label', `Rolle für ${employee.fullName || 'Mitarbeiter'}`)
  const options = [
    ['employee', 'Mitarbeiter'],
    ['manager', 'Einsatzleiter'],
    ...(currentSession.role === 'owner' ? [['admin', 'Admin']] : []),
  ]
  for (const [value, label] of options) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.append(option)
  }
  select.value = options.some(([value]) => value === role) ? role : 'employee'

  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'primary-button compact'
  save.textContent = 'Rolle ändern'
  save.addEventListener('click', async () => {
    const nextRole = select.value
    save.disabled = true
    select.disabled = true
    try {
      await api('/api/registrations', {
        method: 'PATCH',
        body: JSON.stringify({ id, action: 'update-role', role: nextRole }),
      })
      toast(`${employee.fullName || 'Mitarbeiter'} ist jetzt ${LABELS[nextRole]}.`)
      await refresh()
    } catch (error) {
      toast(error.message || 'Die Rolle konnte nicht geändert werden.', true)
    } finally {
      save.disabled = false
      select.disabled = false
    }
  })

  const deactivate = document.createElement('button')
  deactivate.type = 'button'
  deactivate.className = 'danger-outline compact'
  deactivate.textContent = 'Konto deaktivieren'
  deactivate.addEventListener('click', async () => {
    if (!window.confirm(`${employee.fullName || 'Dieses Konto'} wirklich deaktivieren? Vorhandene Arbeitsdaten bleiben erhalten.`)) return
    deactivate.disabled = true
    save.disabled = true
    select.disabled = true
    try {
      await api('/api/registrations', {
        method: 'PATCH',
        body: JSON.stringify({ id, action: 'deactivate-account' }),
      })
      toast(`${employee.fullName || 'Konto'} wurde deaktiviert.`)
      await refresh()
    } catch (error) {
      toast(error.message || 'Das Konto konnte nicht deaktiviert werden.', true)
    } finally {
      deactivate.disabled = false
      save.disabled = false
      select.disabled = false
    }
  })

  actions.append(select, save, deactivate)
  wrapper.append(actions)
  card.append(wrapper)
}

async function refresh() {
  if (running) {
    queued = true
    return
  }
  running = true
  try {
    if (!onPage()) {
      cachedSession = null
      clearInjected()
      return
    }
    installStyles()
    const currentSession = await session()
    if (!['owner', 'admin', 'manager'].includes(currentSession.role)) return
    const cards = [...document.querySelectorAll('.employee-grid article')]
    if (!cards.length) return
    const data = await api('/api/registrations')
    const employees = Array.isArray(data.employees) ? data.employees : []
    clearInjected()
    cards.forEach((card, index) => {
      const employee = employeeFor(card, employees, index)
      if (employee) addEditor(card, employee, currentSession, refresh)
    })
  } catch (error) {
    console.error('Habun Mitarbeiterrollen', error)
  } finally {
    running = false
    if (queued) {
      queued = false
      scheduleRefresh(150)
    }
  }
}

function scheduleRefresh(delay = 120) {
  clearTimeout(timer)
  timer = setTimeout(refresh, delay)
}

function isOwnMutationNode(node) {
  if (!(node instanceof Element)) return true
  return Boolean(
    node.matches('[data-employee-role-management],[data-employee-role-toast],style[data-employee-role-styles]') ||
    node.closest('[data-employee-role-management],[data-employee-role-toast]')
  )
}

function mutationNeedsRefresh(mutations) {
  return mutations.some((mutation) => {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes]
    return nodes.some((node) => !isOwnMutationNode(node))
  })
}

export function installEmployeeRoleManagement() {
  if (observer) return
  observer = new MutationObserver((mutations) => {
    if (mutationNeedsRefresh(mutations)) scheduleRefresh()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  scheduleRefresh(0)
}

installEmployeeRoleManagement()
