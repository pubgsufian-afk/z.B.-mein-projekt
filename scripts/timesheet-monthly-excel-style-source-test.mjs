import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheet-monthly-reports.mts', 'utf8')

// Both exports must resolve the legacy rectangular default logo to the transparent PDF asset.
assert.match(source, /function exportLogoUrl\(logoUrl: string\)/)
assert.match(source, /resolved === '\/habun-logo\.png' \? '\/habun-logo-pdf\.png' : resolved/)
assert.match(source, /loadExportLogo\(request, settings\.logoUrl\)/)

// PDF keeps the established Stundenzettel structure, but shows the clean logo without the grey rectangle.
assert.match(source, /page\.drawText\('Stundenzettel'/)
assert.match(source, /Arbeitnehmer:/)
assert.match(source, /Anmerkungen/)
assert.match(source, /width: logoWidth,[\s\S]*height: logoHeight,[\s\S]*opacity: 1/)

// Excel mirrors the PDF instead of using the previous landscape office-sheet layout.
assert.match(source, /async function buildXlsx\(request: Request, rows: TimesheetEntry\[\], from: string, to: string\)/)
assert.match(source, /orientation: 'portrait'/)
assert.match(source, /fitToHeight: 1/)
assert.match(source, /rowsWithBlankDates\(employeeRows, from, to\)/)
assert.match(source, /\['Datum', 'Startzeit', 'Endzeit', 'Pause', 'Dauer', 'Status', 'Tätigkeit \/ Einsatzort'\]/)
assert.match(source, /Gesamtdauer/)
assert.match(source, /Anmerkungen/)
assert.match(source, /workbook\.addImage/)
assert.match(source, /sheet\.addImage/)
assert.match(source, /headerFooter\.oddFooter/)
assert.doesNotMatch(source, /orientation: 'landscape'/)
assert.doesNotMatch(source, /sheet\.getCell\('A1'\)\.fill = \{ type: 'pattern', pattern: 'solid', fgColor: \{ argb: colors\.dark \} \}/)

console.log('PDF/Excel Stundenzettel parity source contract passed')
