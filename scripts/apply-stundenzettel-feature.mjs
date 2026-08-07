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

async function removeFromFile(path, marker) {
  let source = await readFile(path, 'utf8')
  if (!source.includes(marker)) return false
  source = source.replace(marker, '')
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

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "  { key: 'times', label: 'Zeiten', roles: ['owner', 'admin', 'manager'] },",
  "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager', 'employee'] },",
  'Stundenzettel-Navigation',
))

mark('frontend/src/App.jsx', await removeFromFile(
  'frontend/src/App.jsx',
  "  { key: 'corrections', label: 'Korrekturen', roles: ['owner', 'admin', 'manager'] },\n",
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

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  ": page === 'times' ? <TimesPage session={session} />",
  ": page === 'timesheet' ? <TimesheetPage session={session} />",
  'Stundenzettel-Routing',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /\n\s*: page === 'corrections' \? <CorrectionsPage session=\{session\} \/>/,
  '',
  "page === 'timesheet' ? <TimesheetPage session={session} />",
  'Korrekturen-Routing',
))

mark('netlify/functions/_shared/attendance-service.mts', await replaceInFile(
  'netlify/functions/_shared/attendance-service.mts',
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')\n      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      const historyUserId = current.role === 'employee' ? current.userId : normalizedText(filters.userId)\n      return { entries: await repository.listHistory({ userId: historyUserId, from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  'Mitarbeiter-Eigenhistorie',
))

mark('netlify/functions/attendance.mts', await removeFromFile(
  'netlify/functions/attendance.mts',
  "        if (actor.role === 'employee') return response({ message: 'Keine Berechtigung.', code: 'FORBIDDEN' }, 403)\n",
))

mark('netlify/functions/timesheet-reports.mts', await replaceInFile(
  'netlify/functions/timesheet-reports.mts',
  'const placeholders = userIds.map((_, index) => `$${index + 4}`).join(\', \')',
  'const placeholders = userIds.map((_, index) => `$${index + 3}`).join(\', \')',
  'Stundenzettel-Report-Parameter',
))

console.log(changed.length ? `Stundenzettel feature applied: ${[...new Set(changed)].join(', ')}` : 'Stundenzettel feature already applied')
