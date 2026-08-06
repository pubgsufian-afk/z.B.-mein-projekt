import { readFile, writeFile } from 'node:fs/promises'

async function update(path, transform) {
  const before = await readFile(path, 'utf8')
  const after = transform(before)
  if (after === before) return false
  await writeFile(path, after)
  return true
}

function insertAfter(source, marker, addition) {
  if (source.includes(addition.trim())) return source
  if (!source.includes(marker)) throw new Error(`Marker fehlt: ${marker}`)
  return source.replace(marker, `${marker}${addition}`)
}

const changed = []

if (await update('frontend/src/App.jsx', (source) => {
  let next = insertAfter(
    source,
    "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n",
    "import { berlinDate } from './berlin-date.mjs'\n",
  )
  next = next.replaceAll("new Date().toISOString().slice(0, 10)", 'berlinDate(new Date())')
  return next
})) changed.push('frontend/src/App.jsx')

if (await update('netlify/functions/unified-reports.mts', (source) => {
  let next = insertAfter(
    source,
    "import { databaseConnectionString } from './_shared/database-connection.mts'\n",
    "import { attendanceEventNeedsReview } from './_shared/report-warning.mjs'\n",
  )
  next = next.replace(
    "warning: current.events.some((event) => event.location_status !== 'inside' || event.offline_captured),",
    'warning: current.events.some(attendanceEventNeedsReview),',
  )
  return next
})) changed.push('netlify/functions/unified-reports.mts')

if (await update('netlify/functions/schedule-v2.mts', (source) => {
  let next = insertAfter(
    source,
    "import { getUser, verifyRequestOrigin } from '@netlify/identity'\n",
    "import { sameScheduleShift } from './_shared/schedule-copy-guard.mjs'\n",
  )
  next = next.replace(
    "  const source = (await allShifts()).filter((entry) => mondayOf(entry.date) === previousMonday && entry.status === 'published')\n  const created: Shift[] = []",
    "  const source = (await allShifts()).filter((entry) => mondayOf(entry.date) === previousMonday && entry.status === 'published')\n  const targetRows = (await allShifts()).filter((entry) => mondayOf(entry.date) === targetMonday)\n  const created: Shift[] = []",
  )
  next = next.replace(
    "    const copy = makeShift({ ...item, id: crypto.randomUUID(), date: date.toISOString().slice(0, 10), status: 'draft', version: 0 }, current)\n    await store().setJSON(shiftKey(copy), copy)\n    created.push(copy)",
    "    const copy = makeShift({ ...item, id: crypto.randomUUID(), date: date.toISOString().slice(0, 10), status: 'draft', version: 0 }, current)\n    if (targetRows.some((entry) => sameScheduleShift(entry, copy))) continue\n    await store().setJSON(shiftKey(copy), copy)\n    created.push(copy)\n    targetRows.push(copy)",
  )
  return next
})) changed.push('netlify/functions/schedule-v2.mts')

if (!changed.length) {
  console.log('Portal audit fixes already applied')
} else {
  console.log(`Applied portal audit fixes: ${changed.join(', ')}`)
}
