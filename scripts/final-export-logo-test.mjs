import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const helper = await readFile('netlify/functions/_shared/pdf-shield-logo.mts', 'utf8')
const report = await readFile('netlify/functions/unified-reports-fixed.mts', 'utf8')

assert.match(helper, /LOGO_CROP_LEFT/, 'PDF-Logo verwendet noch keine saubere rechteckige Original-Crop-Fläche.')
assert.match(helper, /LOGO_CROP_TOP/, 'PDF-Logo-Crop hat keine definierte Oberkante.')
assert.match(helper, /LOGO_CROP_WIDTH/, 'PDF-Logo-Crop hat keine definierte Breite.')
assert.match(helper, /LOGO_CROP_HEIGHT/, 'PDF-Logo-Crop hat keine definierte Höhe.')
assert.doesNotMatch(helper, /SHIELD_LEFT|SHIELD_TOP|SHIELD_WIDTH|SHIELD_HEIGHT/, 'Die alte polygonale Schild-Maske ist noch aktiv.')

assert.match(report, /workbook\.addImage\(/, 'Excel enthält noch kein Firmenlogo.')
assert.match(report, /buildExcel\(request: Request,/, 'Excel bekommt die Request-URL zum Laden des Logos noch nicht.')
assert.match(report, /await buildExcel\(request, rows, from, to\)/, 'Excel-Export ruft die Logo-fähige Builder-Funktion noch nicht auf.')

console.log('Final export logo tests passed')
