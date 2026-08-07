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

function updatePdfHeader(source, title) {
  let next = source.replace('drawCenteredShieldLogo(page, logo, width, height - 22, 64)', 'drawCenteredShieldLogo(page, logo, width, height - 22, 94)')
  next = next.replace(
    "    const company = pdfText(settings.companyName || 'Habun Security', 70)\n    const phone = pdfText(settings.phone || 'Telefon nicht hinterlegt', 70)\n    const email = pdfText(settings.email || 'E-Mail nicht hinterlegt', 90)\n    page.drawText(company, { x: centeredTextX(bold, company, 16, width), y: 482, size: 16, font: bold, color: rgb(.08, .08, .08) })\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 466, size: 8.5, font: regular })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 453, size: 8.5, font: regular })\n    page.drawText('Stundenbericht', { x: margin, y: 424, size: 15, font: bold })\n    page.drawText(pdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 408, size: 8.5, font: regular })\n    y = 378",
    "    const company = pdfText(settings.companyName, 80)\n    const phone = pdfText(settings.phone, 70)\n    const email = pdfText(settings.email, 90)\n    const address = pdfText(settings.address, 100)\n    page.drawText(company, { x: centeredTextX(bold, company, 15, width), y: 453, size: 15, font: bold, color: rgb(.08, .08, .08) })\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 438, size: 8.5, font: regular })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 425, size: 8.5, font: regular })\n    page.drawText(address, { x: centeredTextX(regular, address, 8.5, width), y: 412, size: 8.5, font: regular })\n    page.drawText('Stundenbericht', { x: margin, y: 382, size: 15, font: bold })\n    page.drawText(pdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 366, size: 8.5, font: regular })\n    y = 336",
  )
  next = next.replace(
    "    const company = safePdfText(settings.companyName || 'Habun Security', 70)\n    const phone = safePdfText(settings.phone || 'Telefon nicht hinterlegt', 70)\n    const email = safePdfText(settings.email || 'E-Mail nicht hinterlegt', 90)\n    page.drawText(company, { x: centeredTextX(bold, company, 16, width), y: 482, size: 16, font: bold, color: rgb(.08, .08, .08) })\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 466, size: 8.5, font: regular })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 453, size: 8.5, font: regular })\n    page.drawText('Dienstplan', { x: margin, y: 424, size: 15, font: bold })\n    page.drawText(safePdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 408, size: 8.5, font: regular })\n    y = 378",
    "    const company = safePdfText(settings.companyName, 80)\n    const phone = safePdfText(settings.phone, 70)\n    const email = safePdfText(settings.email, 90)\n    const address = safePdfText(settings.address, 100)\n    page.drawText(company, { x: centeredTextX(bold, company, 15, width), y: 453, size: 15, font: bold, color: rgb(.08, .08, .08) })\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: 438, size: 8.5, font: regular })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: 425, size: 8.5, font: regular })\n    page.drawText(address, { x: centeredTextX(regular, address, 8.5, width), y: 412, size: 8.5, font: regular })\n    page.drawText('Dienstplan', { x: margin, y: 382, size: 15, font: bold })\n    page.drawText(safePdfText(`Zeitraum ${from} bis ${to} - Seite ${pageNumber}`), { x: margin, y: 366, size: 8.5, font: regular })\n    y = 336",
  )
  if (title === 'Stundenbericht') {
    next = next.replace("  sheet.addRow([clean(settings.phone), clean(settings.email)])", "  sheet.addRow([clean(settings.phone), clean(settings.email), clean(settings.address)])")
  }
  return next
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

if (await update('netlify/functions/unified-reports-fixed.mts', (source) => updatePdfHeader(source, 'Stundenbericht'))) {
  changed.push('netlify/functions/unified-reports-fixed.mts')
}

if (await update('netlify/functions/schedule-pdf-fixed.mts', (source) => updatePdfHeader(source, 'Dienstplan'))) {
  changed.push('netlify/functions/schedule-pdf-fixed.mts')
}

if (!changed.length) {
  console.log('Portal audit fixes already applied')
} else {
  console.log(`Applied portal audit fixes: ${changed.join(', ')}`)
}
