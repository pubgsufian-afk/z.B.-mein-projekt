import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

async function replaceInFile(path, before, after, label, alreadyAppliedVariants = []) {
  let source = await readFile(path, 'utf8')
  if (source.includes(after) || alreadyAppliedVariants.some((variant) => source.includes(variant))) return
  assert.ok(source.includes(before), `${label} wurde in ${path} nicht gefunden.`)
  source = source.replace(before, after)
  await writeFile(path, source)
}

async function replaceAllInFile(path, before, after, minimumCount, label) {
  let source = await readFile(path, 'utf8')
  if (source.includes(after)) return
  const count = source.split(before).length - 1
  assert.ok(count >= minimumCount, `${label} wurde in ${path} nicht oft genug gefunden.`)
  source = source.split(before).join(after)
  await writeFile(path, source)
}

// 1) Dienstplan-Formular: Nachtschichten (z. B. 22:00–06:00) als einen Dienst zulassen.
await replaceInFile(
  'public/improvements.js',
  `  const pageTitle = () => textOf(document.querySelector(".topbar h1, .employee-app main h1"));`,
  `  const shiftDurationMinutes = (startValue, endValue) => {\n    const from = minutes(startValue);\n    const to = minutes(endValue);\n    if (from === null || to === null) return null;\n    if (from === to) return 0;\n    return to > from ? to - from : to + 1440 - from;\n  };\n\n  const pageTitle = () => textOf(document.querySelector(".topbar h1, .employee-app main h1"));`,
  'Hilfsfunktion für Nachtschicht-Dauer',
)

await replaceInFile(
  'public/improvements.js',
  `      const update = () => {\n        const from = minutes(start?.value);\n        const to = minutes(end?.value);\n        if (from === null || to === null) return;\n        if (to <= from) {\n          addFormSummary(form, "<strong>Bitte prüfen</strong> Das Dienstende muss nach dem Beginn liegen.");\n          return;\n        }\n        const hours = ((to - from) / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 });\n        addFormSummary(form, \`<strong>Geplante Dauer</strong> \${hours} Stunden\`);\n      };`,
  `      const update = () => {\n        const duration = shiftDurationMinutes(start?.value, end?.value);\n        if (duration === null) return;\n        if (duration === 0) {\n          addFormSummary(form, "<strong>Bitte prüfen</strong> Dienstbeginn und Dienstende dürfen nicht identisch sein.");\n          return;\n        }\n        const hours = (duration / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 });\n        addFormSummary(form, \`<strong>Geplante Dauer</strong> \${hours} Stunden\`);\n      };`,
  'Dienstplan-Daueranzeige',
)

await replaceInFile(
  'public/improvements.js',
  `        const from = minutes(start?.value);\n        const to = minutes(end?.value);\n        if (from !== null && to !== null && to <= from) {\n          event.preventDefault();\n          event.stopImmediatePropagation();\n          ensureStatus(form, "Das Dienstende muss nach dem Beginn liegen. Dienste über Mitternacht bitte als zwei Einträge erfassen.", "error");\n          end?.focus();\n        }`,
  `        const duration = shiftDurationMinutes(start?.value, end?.value);\n        if (duration === 0) {\n          event.preventDefault();\n          event.stopImmediatePropagation();\n          ensureStatus(form, "Dienstbeginn und Dienstende dürfen nicht identisch sein.", "error");\n          end?.focus();\n        }`,
  'Dienstplan-Submit-Prüfung',
)

// 2) Beide Dienstplan-Backends verwenden dieselbe über-Mitternacht-Dauer.
for (const path of ['netlify/functions/schedule-v2.mts', 'netlify/functions/schedule-v2-neon.mts']) {
  await replaceInFile(
    path,
    `function minutes(value: string) {\n  const [hours, mins] = value.split(':').map(Number)\n  return hours * 60 + mins\n}`,
    `function minutes(value: string) {\n  const [hours, mins] = value.split(':').map(Number)\n  return hours * 60 + mins\n}\n\nfunction shiftDurationMinutes(startValue: string, endValue: string) {\n  const start = minutes(startValue)\n  const end = minutes(endValue)\n  if (start === end) return 0\n  return end > start ? end - start : end + 1440 - start\n}`,
    'Backend-Hilfsfunktion für Nachtschicht-Dauer',
  )
  await replaceInFile(
    path,
    `  if (minutes(String(body.end)) <= minutes(String(body.start))) throw new RangeError('Das Dienstende muss nach dem Beginn liegen.')\n  const pause = Number(body.pauseMinutes ?? 0)\n  const duration = minutes(String(body.end)) - minutes(String(body.start))\n  if (!Number.isFinite(pause) || pause < 0 || pause >= duration) throw new RangeError('Die Pause muss kürzer als die Dienstzeit sein.')`,
    `  const duration = shiftDurationMinutes(String(body.start), String(body.end))\n  if (duration <= 0) throw new RangeError('Dienstbeginn und Dienstende dürfen nicht identisch sein.')\n  const pause = Number(body.pauseMinutes ?? 0)\n  if (!Number.isFinite(pause) || pause < 0 || pause >= duration) throw new RangeError('Die Pause muss kürzer als die Dienstzeit sein.')`,
    'Backend-Dienstplanvalidierung',
  )
}

// 3) Überschneidungen auch über Mitternacht und über den Tageswechsel erkennen.
await replaceInFile(
  'netlify/functions/schedule-v2.mts',
  `function overlap(left: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>, right: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>) {\n  return left.employeeUserId === right.employeeUserId\n    && left.date === right.date\n    && minutes(left.start) < minutes(right.end)\n    && minutes(right.start) < minutes(left.end)\n}`,
  `function scheduleDateOrdinal(value: string) {\n  const parsed = Date.parse(String(value || '') + 'T00:00:00Z')\n  return Number.isFinite(parsed) ? Math.floor(parsed / 86400000) : null\n}\n\nfunction shiftBounds(shift: Pick<Shift, 'date' | 'start' | 'end'>) {\n  const day = scheduleDateOrdinal(shift.date)\n  if (day === null) return null\n  const startMinute = minutes(shift.start)\n  const endMinute = minutes(shift.end)\n  const startStamp = day * 1440 + startMinute\n  const endStamp = day * 1440 + endMinute + (endMinute < startMinute ? 1440 : 0)\n  return { startStamp, endStamp }\n}\n\nfunction overlap(left: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>, right: Pick<Shift, 'date' | 'start' | 'end' | 'employeeUserId'>) {\n  if (left.employeeUserId !== right.employeeUserId) return false\n  const leftBounds = shiftBounds(left)\n  const rightBounds = shiftBounds(right)\n  return Boolean(leftBounds && rightBounds\n    && leftBounds.startStamp < rightBounds.endStamp\n    && rightBounds.startStamp < leftBounds.endStamp)\n}`,
  'Legacy-Überschneidungsprüfung',
)

await replaceInFile(
  'netlify/functions/_shared/schedule-neon-repository.mts',
  `export async function listScheduleOverlaps(candidate: Pick<ScheduleShift, 'employeeUserId' | 'date' | 'start' | 'end'>, excludeId = '') {\n  const database = getDatabase()\n  const result = await database.pool.query(\n    \`SELECT * FROM schedule_shifts\n      WHERE employee_user_id = $1\n        AND shift_date = $2::date\n        AND start_time < $4::time\n        AND $3::time < end_time\n        AND ($5 = '' OR id <> $5)\n      ORDER BY start_time, id\`,\n    [candidate.employeeUserId, candidate.date, candidate.start, candidate.end, excludeId],\n  )\n  return result.rows.map((row) => mapScheduleShiftRow(row))\n}`,
  `export async function listScheduleOverlaps(candidate: Pick<ScheduleShift, 'employeeUserId' | 'date' | 'start' | 'end'>, excludeId = '') {\n  const database = getDatabase()\n  const result = await database.pool.query(\n    \`SELECT * FROM schedule_shifts\n      WHERE employee_user_id = $1\n        AND (shift_date + start_time) < (\n          $2::date + $4::time + CASE WHEN $4::time < $3::time THEN interval '1 day' ELSE interval '0 day' END\n        )\n        AND ($2::date + $3::time) < (\n          shift_date + end_time + CASE WHEN end_time < start_time THEN interval '1 day' ELSE interval '0 day' END\n        )\n        AND ($5 = '' OR id <> $5)\n      ORDER BY shift_date, start_time, id\`,\n    [candidate.employeeUserId, candidate.date, candidate.start, candidate.end, excludeId],\n  )\n  return result.rows.map((row) => mapScheduleShiftRow(row))\n}`,
  'Neon-Überschneidungsprüfung',
)

// 4) Zeiterfassung: Zeitfenster datumssicher machen und offene Nachtschicht nach Mitternacht weiterführen.
await replaceInFile(
  'netlify/functions/attendance.mts',
  `function scheduleTime(value: string | undefined) {\n  const [hour, minute] = String(value || '').split(':').map(Number)\n  return Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59\n    ? hour * 60 + minute\n    : null\n}`,
  `function scheduleTime(value: string | undefined) {\n  const [hour, minute] = String(value || '').split(':').map(Number)\n  return Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59\n    ? hour * 60 + minute\n    : null\n}\n\nfunction dateOrdinal(value: string | undefined) {\n  const text = String(value || '')\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(text)) return null\n  const parsed = Date.parse(text + 'T00:00:00Z')\n  return Number.isFinite(parsed) ? Math.floor(parsed / 86400000) : null\n}\n\nfunction attendanceStamp(value: string | Date | null | undefined) {\n  if (!value) return null\n  const minute = timeMinutes(value)\n  const date = eventDateInBerlin(value)\n  const day = dateOrdinal(date)\n  return minute === null || day === null ? null : { date, minute, stamp: day * 1440 + minute }\n}\n\nfunction scheduleBounds(entry: ScheduleEntry | null | undefined) {\n  if (!entry) return null\n  const day = dateOrdinal(entry.date)\n  const start = scheduleTime(entry.start)\n  const end = scheduleTime(entry.end)\n  if (day === null || start === null || end === null || start === end) return null\n  const startStamp = day * 1440 + start\n  const endStamp = day * 1440 + end + (end < start ? 1440 : 0)\n  return { start, end, startStamp, endStamp }\n}`,
  'Datumsbasierte Dienstzeit-Hilfsfunktionen',
)

await replaceInFile(
  'netlify/functions/attendance.mts',
  `export function clockingWindowForSchedule(\n  entry: ScheduleEntry | null | undefined,\n  occurredAt: string | Date | null | undefined,\n  earlyMinutes = CLOCKING_EARLY_MINUTES,\n) {\n  if (!entry) return { allowed: false, code: 'NO_PUBLISHED_SHIFT', opensAtMinute: null, closesAtMinute: null }\n  const currentMinute = timeMinutes(occurredAt)\n  const start = scheduleTime(entry.start)\n  const end = scheduleTime(entry.end)\n  const early = Number.isFinite(Number(earlyMinutes)) && Number(earlyMinutes) >= 0 ? Math.round(Number(earlyMinutes)) : CLOCKING_EARLY_MINUTES\n  if (currentMinute === null || start === null || end === null) {\n    return { allowed: false, code: 'INVALID_SHIFT_WINDOW', opensAtMinute: null, closesAtMinute: null }\n  }\n\n  const opensAtMinute = (start - early + 1440) % 1440\n  const wrapsMidnight = end < start || start < early\n  const allowed = wrapsMidnight\n    ? currentMinute >= opensAtMinute || currentMinute <= end\n    : currentMinute >= opensAtMinute && currentMinute <= end\n  return { allowed, code: allowed ? 'CLOCKING_ALLOWED' : 'OUTSIDE_SHIFT_WINDOW', opensAtMinute, closesAtMinute: end }\n}`,
  `export function clockingWindowForSchedule(\n  entry: ScheduleEntry | null | undefined,\n  occurredAt: string | Date | null | undefined,\n  earlyMinutes = CLOCKING_EARLY_MINUTES,\n) {\n  if (!entry) return { allowed: false, code: 'NO_PUBLISHED_SHIFT', opensAtMinute: null, closesAtMinute: null }\n  const current = attendanceStamp(occurredAt)\n  const bounds = scheduleBounds(entry)\n  const early = Number.isFinite(Number(earlyMinutes)) && Number(earlyMinutes) >= 0 ? Math.round(Number(earlyMinutes)) : CLOCKING_EARLY_MINUTES\n  if (!current || !bounds) {\n    return { allowed: false, code: 'INVALID_SHIFT_WINDOW', opensAtMinute: null, closesAtMinute: null }\n  }\n  const opensAtStamp = bounds.startStamp - early\n  const allowed = current.stamp >= opensAtStamp && current.stamp <= bounds.endStamp\n  return {\n    allowed,\n    code: allowed ? 'CLOCKING_ALLOWED' : 'OUTSIDE_SHIFT_WINDOW',\n    opensAtMinute: ((bounds.start - early) % 1440 + 1440) % 1440,\n    closesAtMinute: bounds.end,\n  }\n}`,
  'Datumsbasierte Stempelzeit-Prüfung',
)

await replaceInFile(
  'netlify/functions/attendance.mts',
  `export function displayAttendancePhase(\n  phase: string | null | undefined,\n  schedule: ScheduleEntry | null | undefined,\n  occurredAt: string | Date | null | undefined,\n) {\n  if (phase === 'working' || phase === 'paused') return phase\n  const window = clockingWindowForSchedule(schedule, occurredAt)\n  if (!window.allowed) return 'blocked'\n  if (phase === 'completed') return 'idle'\n  return phase || 'idle'\n}`,
  `export function displayAttendancePhase(\n  phase: string | null | undefined,\n  schedule: ScheduleEntry | null | undefined,\n  occurredAt: string | Date | null | undefined,\n) {\n  if (phase === 'working' || phase === 'paused') return phase\n  const window = clockingWindowForSchedule(schedule, occurredAt)\n  if (phase === 'completed') return window.allowed ? 'idle' : 'completed'\n  if (!window.allowed) return 'blocked'\n  return phase || 'idle'\n}`,
  'Anzeigephase nach abgeschlossenem Dienst',
)

await replaceInFile(
  'netlify/functions/attendance.mts',
  `export function selectPlannedSchedule(\n  entries: ScheduleEntry[],\n  userId: string,\n  date: string,\n  requestedScheduleId: string | null,\n  occurredAt: string | Date | null = null,\n) {\n  const candidates = plannedSchedules(entries, userId, date)\n  if (requestedScheduleId) {\n    const requested = candidates.find((entry) => String(entry.id || '') === requestedScheduleId)\n    if (requested) return requested\n  }\n  const currentMinute = timeMinutes(occurredAt)\n  if (currentMinute === null) return candidates[0] || null\n  const active = candidates.find((entry) => {\n    const start = scheduleTime(entry.start)\n    const end = scheduleTime(entry.end)\n    return start !== null && end !== null && currentMinute >= start && currentMinute <= end\n  })\n  if (active) return active\n  const upcoming = candidates.find((entry) => {\n    const start = scheduleTime(entry.start)\n    return start !== null && start >= currentMinute\n  })\n  return upcoming || candidates.at(-1) || null\n}`,
  `export function selectPlannedSchedule(\n  entries: ScheduleEntry[],\n  userId: string,\n  date: string,\n  requestedScheduleId: string | null,\n  occurredAt: string | Date | null = null,\n) {\n  const candidates = (Array.isArray(entries) ? entries : [])\n    .filter((entry) => String(entry.employeeUserId || '') === userId && entry.status !== 'draft')\n  if (requestedScheduleId) {\n    const requested = candidates.find((entry) => String(entry.id || '') === requestedScheduleId)\n    if (requested) return requested\n  }\n  const current = attendanceStamp(occurredAt)\n  if (!current) return plannedSchedules(entries, userId, date)[0] || null\n  const bounded = candidates\n    .map((entry) => ({ entry, bounds: scheduleBounds(entry) }))\n    .filter((item): item is { entry: ScheduleEntry; bounds: NonNullable<ReturnType<typeof scheduleBounds>> } => Boolean(item.bounds))\n  const active = bounded\n    .filter((item) => current.stamp >= item.bounds.startStamp && current.stamp <= item.bounds.endStamp)\n    .sort((left, right) => right.bounds.startStamp - left.bounds.startStamp)[0]\n  if (active) return active.entry\n  const clockable = bounded\n    .filter((item) => current.stamp >= item.bounds.startStamp - CLOCKING_EARLY_MINUTES && current.stamp <= item.bounds.endStamp)\n    .sort((left, right) => left.bounds.startStamp - right.bounds.startStamp)[0]\n  if (clockable) return clockable.entry\n  const today = plannedSchedules(entries, userId, date)\n  if (today.length) return today.at(-1) || null\n  const previous = bounded\n    .filter((item) => item.bounds.endStamp < current.stamp)\n    .sort((left, right) => right.bounds.startStamp - left.bounds.startStamp)[0]\n  return previous?.entry || null\n}`,
  'Dienst-Auswahl über Mitternacht',
)

await replaceInFile(
  'netlify/functions/attendance.mts',
  `        return response({\n          ...state,\n          phase: visiblePhase,\n          rawPhase: state.phase,\n          schedule: schedulePayload(schedule),`,
  `        return response({\n          ...state,\n          events: (state.events || []).filter((entry) => String(entry.eventDate || '') === today),\n          phase: visiblePhase,\n          rawPhase: state.phase,\n          schedule: schedulePayload(schedule),`,
  'Heutige Buchungen trotz Nachtschicht',
)

await replaceInFile(
  'netlify/functions/_shared/daily-attendance-service.mts',
  `    async listEvents(userId: string) {\n      const entries = await repository.listEvents(userId)\n      const today = eventDateInBerlin(now())\n      return (Array.isArray(entries) ? entries : []).filter((entry) => String(entry.eventDate || '') === today)\n    },`,
  `    async listEvents(userId: string) {\n      const entries = [...(Array.isArray(await repository.listEvents(userId)) ? await repository.listEvents(userId) : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))\n      const today = eventDateInBerlin(now())\n      const todayEntries = entries.filter((entry) => String(entry.eventDate || '') === today)\n      let phase = 'idle'\n      let openStart = -1\n      for (let index = 0; index < entries.length; index += 1) {\n        const entry = entries[index]\n        if (String(entry.eventDate || '') >= today) break\n        if (entry.action === 'clock-in' && (phase === 'idle' || phase === 'completed')) { phase = 'working'; openStart = index }\n        else if (entry.action === 'break-start' && phase === 'working') phase = 'paused'\n        else if (entry.action === 'break-end' && phase === 'paused') phase = 'working'\n        else if (entry.action === 'clock-out' && phase === 'working') { phase = 'completed'; openStart = -1 }\n      }\n      if ((phase === 'working' || phase === 'paused') && openStart >= 0) {\n        const carried = entries.slice(openStart).filter((entry) => String(entry.eventDate || '') <= today)\n        return carried\n      }\n      return todayEntries\n    },`,
  'Nachtschicht-Fortsetzung in der Zeiterfassung',
  [
    `    async listEvents(userId: string) {\n      const rawEntries = await repository.listEvents(userId)\n      const entries = [...(Array.isArray(rawEntries) ? rawEntries : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))\n      const today = eventDateInBerlin(now())\n      const todayEntries = entries.filter((entry) => String(entry.eventDate || '') === today)\n      let phase = 'idle'\n      let openStart = -1\n      for (let index = 0; index < entries.length; index += 1) {\n        const entry = entries[index]\n        if (String(entry.eventDate || '') >= today) break\n        if (entry.action === 'clock-in' && (phase === 'idle' || phase === 'completed')) { phase = 'working'; openStart = index }\n        else if (entry.action === 'break-start' && phase === 'working') phase = 'paused'\n        else if (entry.action === 'break-end' && phase === 'paused') phase = 'working'\n        else if (entry.action === 'clock-out' && phase === 'working') { phase = 'completed'; openStart = -1 }\n      }\n      if ((phase === 'working' || phase === 'paused') && openStart >= 0) {\n        const carried = entries.slice(openStart).filter((entry) => String(entry.eventDate || '') <= today)\n        return carried\n      }\n      return todayEntries\n    },`,
  ],
)

// Avoid reading the repository twice in the daily attendance wrapper.
await replaceInFile(
  'netlify/functions/_shared/daily-attendance-service.mts',
  `      const entries = [...(Array.isArray(await repository.listEvents(userId)) ? await repository.listEvents(userId) : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))`,
  `      const rawEntries = await repository.listEvents(userId)\n      const entries = [...(Array.isArray(rawEntries) ? rawEntries : [])]\n        .sort((left, right) => String(left.clientOccurredAt || '').localeCompare(String(right.clientOccurredAt || '')))`,
  'Einmaliges Laden der Zeiterfassungsereignisse',
)

// 5) UI: kein leerer Bedienbereich mehr und abgeschlossene Dienste nach Dienstende korrekt anzeigen.
const phaseLabelBefore = `phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'`
const phaseLabelAfter = `phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : phase === 'blocked' ? 'Arbeitsbeginn nicht verfügbar' : 'Bereit zum Start'`
await replaceAllInFile('frontend/src/App.jsx', phaseLabelBefore, phaseLabelAfter, 2, 'Statusanzeige der Zeiterfassung')

await replaceInFile(
  'frontend/src/App.jsx',
  `{phase === 'completed' && <div className="completed-card"><strong>Dienst abgeschlossen</strong>{!employeeOnly && <span>Arbeitsbeginn {formatDateTime(state.clockInAt)} · Arbeitsende {formatDateTime(state.clockOutAt)}</span>}</div>}`,
  `{phase === 'completed' && <div className="completed-card"><strong>Dienst abgeschlossen</strong>{!employeeOnly && <span>Arbeitsbeginn {formatDateTime(state.clockInAt)} · Arbeitsende {formatDateTime(state.clockOutAt)}</span>}</div>}\n        {phase === 'blocked' && <div className="completed-card"><strong>Arbeitsbeginn nicht verfügbar</strong><span>Der geplante Zeitraum ist beendet. Eine laufende Arbeitszeit kann weiterhin mit „Arbeit beenden“ abgeschlossen werden.</span></div>}`,
  'Hinweis bei gesperrtem Arbeitsbeginn',
)

console.log('Overnight shift and attendance state fixes applied')
