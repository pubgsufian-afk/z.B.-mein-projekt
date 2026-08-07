import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

async function replaceInFile(path, before, after, label) {
  let source = await readFile(path, 'utf8')
  if (source.includes(after)) return false
  assert.ok(source.includes(before), `${label} wurde in ${path} nicht gefunden.`)
  source = source.replace(before, after)
  await writeFile(path, source)
  return true
}

async function replaceRegexInFile(path, pattern, after, doneMarker, label) {
  let source = await readFile(path, 'utf8')
  if (doneMarker && source.includes(doneMarker)) return false
  assert.ok(pattern.test(source), `${label} wurde in ${path} nicht gefunden.`)
  source = source.replace(pattern, after)
  await writeFile(path, source)
  return true
}

async function removeRegexFromFile(path, pattern) {
  let source = await readFile(path, 'utf8')
  if (!pattern.test(source)) return false
  source = source.replace(pattern, '')
  await writeFile(path, source)
  return true
}

const changed = []
const mark = (path, didChange) => { if (didChange) changed.push(path) }

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n",
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\nimport TimesheetPage from './TimesheetPage.jsx'\n",
  'Stundenzettel-Import',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /  \{ key: 'times', label: '[^']+', roles: \['owner', 'admin', 'manager'\] \},/,
  "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager', 'employee'] },",
  "{ key: 'timesheet', label: 'Stundenzettel'",
  'Stundenzettel-Navigation',
))

mark('frontend/src/App.jsx', await removeRegexFromFile(
  'frontend/src/App.jsx',
  /\n\s*\{ key: 'corrections', label: '[^']+', roles: \[[^\]]+\] \},/,
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /(\s*<button type="button" className=\{page === 'schedule' \? 'active' : ''\} onClick=\{\(\) => navigate\('schedule'\)\}>Dienstplan<\/button>)/,
  "$1\n          <button type=\"button\" className={page === 'timesheet' ? 'active' : ''} onClick={() => navigate('timesheet')}>Stundenzettel</button>",
  "navigate('timesheet')}>Stundenzettel</button>",
  'Mitarbeiter-Stundenzettel-Navigation',
))

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "        <main className=\"employee-kiosk-main\" aria-label={page === 'schedule' ? 'Eigener Dienstplan' : 'Mitarbeiter-Zeiterfassung'}>{children}</main>",
  "        <main className=\"employee-kiosk-main\" aria-label={page === 'schedule' ? 'Eigener Dienstplan' : page === 'timesheet' ? 'Eigener Stundenzettel' : 'Mitarbeiter-Zeiterfassung'}>{children}</main>",
  'Mitarbeiter-Stundenzettel-Bezeichnung',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /: page === 'times' \? <TimesPage session=\{session\} \/>/,
  ": page === 'timesheet' ? <TimesheetPage session={session} />",
  "page === 'timesheet' ? <TimesheetPage session={session} />",
  'Stundenzettel-Routing',
))

mark('frontend/src/App.jsx', await removeRegexFromFile(
  'frontend/src/App.jsx',
  /\n\s*: page === 'corrections' \? <CorrectionsPage session=\{session\} \/>/,
))

mark('netlify/functions/_shared/attendance-service.mts', await replaceInFile(
  'netlify/functions/_shared/attendance-service.mts',
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')\n      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      const historyUserId = current.role === 'employee' ? current.userId : normalizedText(filters.userId)\n      return { entries: await repository.listHistory({ userId: historyUserId, from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  'Mitarbeiter-Eigenhistorie',
))

mark('netlify/functions/attendance.mts', await removeRegexFromFile(
  'netlify/functions/attendance.mts',
  /\s*if \(actor\.role === 'employee'\) return response\(\{ message: 'Keine Berechtigung\.', code: 'FORBIDDEN' \}, 403\)\n/,
))

mark('netlify/functions/timesheet-reports.mts', await replaceInFile(
  'netlify/functions/timesheet-reports.mts',
  'const placeholders = userIds.map((_, index) => `$${index + 4}`).join(\', \')',
  'const placeholders = userIds.map((_, index) => `$${index + 3}`).join(\', \')',
  'Stundenzettel-Report-Parameter',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'\n",
  "import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'\nimport { berlinDate } from './berlin-date.mjs'\n",
  'Stundenzettel-Berlin-Datum-Import',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "function formatDuration(minutes) {\n  const total = Math.max(0, Number(minutes) || 0)\n  const hours = Math.floor(total / 60)\n  const rest = Math.round(total % 60)\n  return `${hours}:${String(rest).padStart(2, '0')} Std.`\n}\n",
  "function formatDuration(minutes) {\n  const total = Math.max(0, Number(minutes) || 0)\n  const hours = Math.floor(total / 60)\n  const rest = Math.round(total % 60)\n  return `${hours}:${String(rest).padStart(2, '0')} Std.`\n}\n\nfunction addDateDays(value, amount) {\n  const date = new Date(`${value}T12:00:00Z`)\n  date.setUTCDate(date.getUTCDate() + amount)\n  return date.toISOString().slice(0, 10)\n}\n",
  'Stundenzettel-Datumsbereich-Helfer',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  const today = new Date().toISOString().slice(0, 10)",
  "  const today = berlinDate(new Date())",
  'Stundenzettel-Berlin-Heute',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  const [editor, setEditor] = useState(null)\n\n  const employeeNames = useMemo(() => {",
  "  const [editor, setEditor] = useState(null)\n  const sessionUserId = session.userId || session.id || ''\n\n  const employeeNames = useMemo(() => {",
  'Stundenzettel-Session-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "    if (session.userId) names.set(String(session.userId), session.fullName || 'Mitarbeiter')\n    return names\n  }, [employees, session.fullName, session.userId])",
  "    if (sessionUserId) names.set(String(sessionUserId), session.fullName || 'Mitarbeiter')\n    return names\n  }, [employees, session.fullName, sessionUserId])",
  'Stundenzettel-Mitarbeitername-Session-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "      const params = new URLSearchParams({ resource: 'history', from, to })\n      if (management && userId) params.set('userId', userId)\n      const data = await requestJson(`/api/attendance?${params}`)\n      setActual({ rows: buildActualSessions(data.entries || [], employeeNames), error: '' })",
  "      const historyTo = addDateDays(to, 1)\n      const params = new URLSearchParams({ resource: 'history', from, to: historyTo })\n      if (management && userId) params.set('userId', userId)\n      const data = await requestJson(`/api/attendance?${params}`)\n      const rows = buildActualSessions(data.entries || [], employeeNames).filter((row) => row.date >= from && row.date <= to)\n      setActual({ rows, error: '' })",
  'Stundenzettel-Nachtschicht-Historie',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(session.userId || '') && entry.status === 'published')",
  "      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(sessionUserId) && entry.status === 'published')",
  'Stundenzettel-Mitarbeiter-Dienstplan-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  }, [employeeNames, from, management, session.userId, to, userId])",
  "  }, [employeeNames, from, management, sessionUserId, to, userId])",
  'Stundenzettel-Dienstplan-Abhängigkeiten',
))

console.log(changed.length ? `Stundenzettel feature applied: ${[...new Set(changed)].join(', ')}` : 'Stundenzettel feature already applied')