import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/employee-role-management-auto.js'
let source = await readFile(path, 'utf8')
let changed = false

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  source = source.replace(before, after)
  changed = true
}

function ensureBefore(anchor, addition, marker, label) {
  if (source.includes(marker)) return
  assert.ok(source.includes(anchor), `${label}: Einfügeanker fehlt`)
  source = source.replace(anchor, `${addition}${anchor}`)
  changed = true
}

ensureBefore(
  'const LABELS = {',
  "import { invalidateCachedJson } from './read-cache.js'\n\n",
  "from './read-cache.js'",
  'Read-cache import',
)

replaceOnce(
  `let observer = null\n`,
  `let observer = null\nlet snapshotEmployees = []\nlet snapshotSession = null\nlet snapshotReceivedAt = 0\n`,
  'Snapshot state',
)

replaceOnce(
  `function employeeFor(card, employees, index) {\n  const name = card.querySelector('strong')?.textContent?.trim() || ''\n  return employees.find((employee) => String(employee.fullName || '').trim() === name) || employees[index] || null\n}`,
  `function employeeFor(card, employees) {\n  const userId = String(card.dataset.userId || '')\n  if (userId) {\n    return employees.find((employee) => String(employee.userId || employee.id || '') === userId) || null\n  }\n  const name = card.querySelector('strong')?.textContent?.trim() || ''\n  return employees.find((employee) => String(employee.fullName || '').trim() === name) || null\n}`,
  'Stable employee mapping',
)

const resetSnapshot = `      invalidateCachedJson('/api/registrations')\n      snapshotEmployees = []\n      snapshotReceivedAt = 0\n`

replaceOnce(
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'update-profile', fullName, company, location }),\n      })\n      employee.fullName = fullName`,
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'update-profile', fullName, company, location }),\n      })\n${resetSnapshot}      employee.fullName = fullName`,
  'Profile cache invalidation',
)

replaceOnce(
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'update-role', role: nextRole }),\n      })\n      toast(`,
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'update-role', role: nextRole }),\n      })\n${resetSnapshot}      toast(`,
  'Role cache invalidation',
)

replaceOnce(
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'deactivate-account' }),\n      })\n      toast(`,
  `      await api('/api/registrations', {\n        method: 'PATCH',\n        body: JSON.stringify({ id, action: 'deactivate-account' }),\n      })\n${resetSnapshot}      toast(`,
  'Deactivate cache invalidation',
)

replaceOnce(
  `    if (!onPage()) {\n      cachedSession = null\n      clearInjected()\n      return\n    }`,
  `    if (!onPage()) {\n      cachedSession = null\n      snapshotEmployees = []\n      snapshotSession = null\n      snapshotReceivedAt = 0\n      clearInjected()\n      return\n    }`,
  'Snapshot clear on page leave',
)

replaceOnce(
  `    installStyles()\n    const currentSession = await session()\n    if (!['owner', 'admin', 'manager'].includes(currentSession.role)) return\n    const cards = [...document.querySelectorAll('.employee-grid article')]\n    if (!cards.length) return\n    const data = await api('/api/registrations')\n    const employees = Array.isArray(data.employees) ? data.employees : []\n    clearInjected()\n    cards.forEach((card, index) => {\n      const employee = employeeFor(card, employees, index)\n      if (employee) addEditor(card, employee, currentSession, refresh)\n    })`,
  `    installStyles()\n    const hasRecentSnapshot = Boolean(snapshotSession) && Date.now() - snapshotReceivedAt < 60000\n    const currentSession = hasRecentSnapshot ? snapshotSession : await session()\n    if (!['owner', 'admin', 'manager'].includes(currentSession.role)) return\n    const cards = [...document.querySelectorAll('.employee-grid article')]\n    if (!cards.length) return\n    let employees = snapshotEmployees\n    if (!hasRecentSnapshot) {\n      const data = await api('/api/registrations')\n      employees = Array.isArray(data.employees) ? data.employees : []\n    }\n    clearInjected()\n    cards.forEach((card) => {\n      const employee = employeeFor(card, employees)\n      if (employee) addEditor(card, employee, currentSession, refresh)\n    })`,
  'Snapshot-based employee controls',
)

replaceOnce(
  `export function installEmployeeRoleManagement() {\n  if (observer) return\n  observer = new MutationObserver((mutations) => {`,
  `export function installEmployeeRoleManagement() {\n  if (observer) return\n  window.addEventListener('habun:employee-snapshot', (event) => {\n    const detail = event.detail || {}\n    snapshotEmployees = Array.isArray(detail.employees) ? detail.employees : []\n    snapshotSession = detail.session && typeof detail.session === 'object' ? detail.session : null\n    snapshotReceivedAt = Date.now()\n    scheduleRefresh(0)\n  })\n  observer = new MutationObserver((mutations) => {`,
  'Employee snapshot listener',
)

if (changed) await writeFile(path, source)
console.log(changed ? 'Safe employee role loading applied' : 'Safe employee role loading already applied')
