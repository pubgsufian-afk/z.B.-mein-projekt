let directoryPromise = null

function normalizeEmployee(entry, archived = false) {
  const userId = String(entry?.userId || '').trim()
  const fullName = String(entry?.fullName || entry?.name || '').trim()
  if (!userId || !fullName) return null
  return { userId, fullName, archived }
}

export async function loadEmployeeDirectory(jsonFetch = window.HabunAttendanceV2?.jsonFetch) {
  if (typeof jsonFetch !== 'function') throw new Error('Die Mitarbeiterliste ist noch nicht verfügbar.')
  if (!directoryPromise) {
    directoryPromise = jsonFetch('/api/registrations').then((payload) => {
      const active = (Array.isArray(payload?.employees) ? payload.employees : [])
        .map((entry) => normalizeEmployee(entry, false)).filter(Boolean)
      const archived = (Array.isArray(payload?.archived) ? payload.archived : [])
        .map((entry) => normalizeEmployee(entry, true)).filter(Boolean)
      const unique = new Map()
      for (const employee of [...active, ...archived]) if (!unique.has(employee.userId)) unique.set(employee.userId, employee)
      return {
        active,
        all: [...unique.values()].sort((left, right) => left.fullName.localeCompare(right.fullName, 'de')),
      }
    }).catch((error) => {
      directoryPromise = null
      throw error
    })
  }
  return directoryPromise
}

export function employeeOptions(employees, selectedUserId = '') {
  const selected = String(selectedUserId || '')
  const options = ['<option value="">Bitte wählen</option>']
  for (const employee of Array.isArray(employees) ? employees : []) {
    const value = escapeHtml(employee.userId)
    const name = escapeHtml(employee.fullName)
    const suffix = employee.archived ? ' · archiviert' : ''
    options.push(`<option value="${value}" data-name="${name}" ${employee.userId === selected ? 'selected' : ''}>${name}${suffix}</option>`)
  }
  return options.join('')
}

export function syncEmployeeSelection(form) {
  const select = form?.elements?.employeeUserId
  const name = form?.elements?.employeeName
  if (!select || !name) return
  select.setAttribute('aria-label', 'Mitarbeiter')
  name.value = select.selectedOptions?.[0]?.dataset?.name || ''
}

function applyAccessibleNames(root = document) {
  root.querySelectorAll?.('select[name="employeeUserId"], select[name="employeeSelection"], select[data-live-user]')
    .forEach((select) => select.setAttribute('aria-label', 'Mitarbeiter'))
  root.querySelectorAll?.('select[data-live-object]')
    .forEach((select) => select.setAttribute('aria-label', 'Einsatzort'))
}

if (typeof document !== 'undefined') {
  applyAccessibleNames()
  const observer = new MutationObserver(() => applyAccessibleNames())
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}
