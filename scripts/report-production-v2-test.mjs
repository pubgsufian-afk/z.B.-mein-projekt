import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { buildReportEventQuery } from '../netlify/functions/_shared/report-database.mts'
import { attendanceEventNeedsReview } from '../netlify/functions/_shared/report-warning.mjs'
import { drawCenteredShieldLogo, shieldLogoPlacement } from '../netlify/functions/_shared/pdf-shield-logo.mts'

const [reportSource, scheduleSource, redirects, index, filterScript, logoBytes] = await Promise.all([
  readFile('netlify/functions/unified-reports-fixed.mts', 'utf8'),
  readFile('netlify/functions/schedule-pdf-fixed.mts', 'utf8'),
  readFile('netlify.toml', 'utf8'),
  readFile('public/index.html', 'utf8'),
  readFile('public/report-filter-fix.js', 'utf8'),
  readFile('public/habun-logo.png'),
])

assert.match(reportSource, /loadReportEvents/)
assert.match(reportSource, /attendanceEventNeedsReview/)
assert.match(reportSource, /buildExcel/)
assert.match(reportSource, /buildPdf/)
assert.doesNotMatch(reportSource, /@neondatabase\/serverless|databaseConnectionString/)
assert.match(scheduleSource, /drawCenteredShieldLogo/)
assert.match(reportSource, /settings\.address/)
assert.match(scheduleSource, /settings\.address/)
assert.match(reportSource, /drawCenteredShieldLogo\(page, logo, width, height - 22, 94\)/)
assert.match(scheduleSource, /drawCenteredShieldLogo\(page, logo, width, height - 22, 94\)/)
assert.doesNotMatch(reportSource, /Telefon nicht hinterlegt|E-Mail nicht hinterlegt/)
assert.doesNotMatch(scheduleSource, /Telefon nicht hinterlegt|E-Mail nicht hinterlegt/)
assert.match(redirects, /from = "\/api\/unified-reports"[\s\S]*unified-reports-fixed/)
assert.match(redirects, /from = "\/api\/schedule-pdf"[\s\S]*schedule-pdf-fixed/)
assert.match(index, /report-filter-fix\.js/)
assert.match(filterScript, /Alle Mitarbeiter/)
assert.match(filterScript, /Mitarbeiter ausgewählt/)
assert.doesNotMatch(filterScript, /0 Objekte/)

const allQuery = buildReportEventQuery('2026-07-01', '2026-07-31', [])
assert.deepEqual(allQuery.params, ['2026-07-01', '2026-07-31'])
assert.doesNotMatch(allQuery.text, /user_id IN/)

const selectedQuery = buildReportEventQuery('2026-07-01', '2026-07-31', ['u1', 'u2'])
assert.deepEqual(selectedQuery.params, ['2026-07-01', '2026-07-31', 'u1', 'u2'])
assert.match(selectedQuery.text, /user_id IN \(\$3, \$4\)/)

assert.equal(attendanceEventNeedsReview({ action: 'break-start', location_status: 'unavailable', offline_captured: false }), false)
assert.equal(attendanceEventNeedsReview({ action: 'break-end', location_status: 'unavailable', offline_captured: false }), false)
assert.equal(attendanceEventNeedsReview({ action: 'clock-in', location_status: 'outside', offline_captured: false }), true)

const pdf = await PDFDocument.create()
const page = pdf.addPage([842, 595])
const logo = await pdf.embedPng(logoBytes)
const placement = drawCenteredShieldLogo(page, logo, 842, 573, 94)
assert.ok(placement)
assert.equal(Math.round(placement.centerX), 421)
assert.equal(Math.round(placement.shieldWidth), 94)
const purePlacement = shieldLogoPlacement(logo, 842, 573, 94)
assert.equal(Math.round(purePlacement.centerX), 421)
assert.ok(purePlacement.imageX < purePlacement.centerX)
const pdfBytes = Buffer.from(await pdf.save())
assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')

console.log('Production report database, redirects, warnings, mobile filter and centered PDF logo tests passed')
