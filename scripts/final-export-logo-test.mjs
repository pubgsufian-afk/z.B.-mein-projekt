import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [helper, report, logoAsset] = await Promise.all([
  readFile('netlify/functions/_shared/pdf-shield-logo.mts', 'utf8'),
  readFile('netlify/functions/unified-reports-fixed.mts', 'utf8'),
  readFile('netlify/functions/_shared/export-logo.mts', 'utf8'),
])

assert.match(logoAsset, /EXPORT_LOGO_PNG_BASE64/, 'Transparentes Export-Logo fehlt.')
assert.match(helper, /EXPORT_LOGO_PNG_BASE64/, 'PDF verwendet nicht das neue transparente Export-Logo.')
assert.match(helper, /page\.drawImage\(/, 'PDF zeichnet das Logo nicht.')
assert.doesNotMatch(helper, /LOGO_CROP_LEFT|LOGO_CROP_TOP|LOGO_CROP_WIDTH|LOGO_CROP_HEIGHT/, 'Alte Logo-Crop-Logik ist noch aktiv.')
assert.doesNotMatch(helper, /drawRectangle\(/, 'PDF legt noch einen rechteckigen Hintergrund hinter das Logo.')

assert.match(report, /EXPORT_LOGO_PNG_BASE64/, 'Excel verwendet nicht das neue transparente Export-Logo.')
assert.match(report, /workbook\.addImage\(/, 'Excel enthält noch kein Firmenlogo.')
assert.match(report, /buildExcel\(request: Request,/, 'Excel bekommt den Logo-fähigen Builder noch nicht.')
assert.match(report, /await buildExcel\(request, rows, from, to\)/, 'Excel-Export ruft die Logo-fähige Builder-Funktion noch nicht auf.')
assert.doesNotMatch(report, /FF141414/, 'Excel legt noch einen schwarzen Hintergrund hinter das Logo.')

console.log('Final export logo tests passed')
