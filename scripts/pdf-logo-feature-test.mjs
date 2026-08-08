import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const repoFiles = {
  branding: 'netlify/functions/_shared/pdf-branding.mts',
  shield: 'netlify/functions/_shared/pdf-shield-logo.mts',
  endpoint: 'netlify/functions/company-settings.mts',
  logoEndpoint: 'netlify/functions/company-logo.mts',
  app: 'frontend/src/App.jsx',
  tools: 'frontend/src/pdf-logo-tools.js',
}

assert.equal(existsSync(repoFiles.branding), true, 'Zentrale PDF-Logo-Speicherung fehlt.')
assert.equal(existsSync(repoFiles.logoEndpoint), true, 'Geschützter Logo-Vorschau-Endpunkt fehlt.')
assert.equal(existsSync(repoFiles.tools), true, 'Clientseitige Logo-Aufbereitung fehlt.')

const [branding, shield, endpoint, logoEndpoint, app, tools] = await Promise.all([
  readFile(repoFiles.branding, 'utf8'),
  readFile(repoFiles.shield, 'utf8'),
  readFile(repoFiles.endpoint, 'utf8'),
  readFile(repoFiles.logoEndpoint, 'utf8'),
  readFile(repoFiles.app, 'utf8'),
  readFile(repoFiles.tools, 'utf8'),
])

assert.match(branding, /portal-pdf-branding/)
assert.match(branding, /readPdfLogoBytes/)
assert.match(branding, /saveCustomPdfLogo/)
assert.match(branding, /resetCustomPdfLogo/)
assert.match(branding, /data:image\/png;base64,/)
assert.match(branding, /EXPORT_LOGO_PNG_BASE64/)
assert.match(branding, /getStore\(/)
assert.match(branding, /arrayBuffer/)
assert.match(branding, /89504e470d0a1a0a/i)

assert.match(endpoint, /pdfLogoDataUrl/)
assert.match(endpoint, /resetPdfLogo/)
assert.match(endpoint, /current\.role\s*!==\s*['"]owner['"]/)
assert.match(endpoint, /Keine Berechtigung.*Hauptadmin|Nur.*Hauptadmin/i)
assert.match(logoEndpoint, /readPdfLogoBytes/)
assert.match(logoEndpoint, /\['owner', 'admin'\]/)
assert.match(logoEndpoint, /image\/png/)

assert.match(shield, /readPdfLogoBytes/)
assert.match(shield, /drawCenteredPdfWatermark/)
assert.match(shield, /opacity/)
assert.match(shield, /\(pageWidth - imageWidth\) \/ 2/)
assert.match(shield, /\(pageHeight - imageHeight\) \/ 2/)

assert.match(app, /function SettingsPage\(\{ session \}\)/)
assert.match(app, /Firmenlogo \/ PDF-Logo/)
assert.match(app, /session\.role === ['"]owner['"]/)
assert.match(app, /accept="image\/png,image\/jpeg,image\/webp"/)
assert.match(app, /preparePdfLogo/)
assert.match(app, /Auf Standardlogo zurücksetzen/)
assert.doesNotMatch(app, />Logo-Pfad</)
assert.match(app, /<SettingsPage session=\{session\} \/>/)

assert.match(tools, /removeEdgeConnectedBackground/)
assert.match(tools, /preparePdfLogo/)
assert.match(tools, /toDataURL\(['"]image\/png['"]\)/)
assert.match(tools, /image\/webp/)

const pdfFiles = [
  'netlify/functions/schedule-pdf.mts',
  'netlify/functions/schedule-pdf-fixed.mts',
  'netlify/functions/timesheet-reports.mts',
  'netlify/functions/unified-reports.mts',
  'netlify/functions/unified-reports-fixed.mts',
]
for (const path of pdfFiles) {
  const source = await readFile(path, 'utf8')
  assert.match(source, /drawCenteredPdfWatermark/, `${path} verwendet das zentrale Wasserzeichen noch nicht.`)
  assert.match(source, /loadOriginalLogo/, `${path} lädt das zentrale Logo noch nicht.`)
}

const { removeEdgeConnectedBackground } = await import('../frontend/src/pdf-logo-tools.js')
const pixels = new Uint8ClampedArray([
  0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
  0, 0, 0, 255, 240, 180, 20, 255, 0, 0, 0, 255,
  0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
])
removeEdgeConnectedBackground(pixels, 3, 3, 36)
assert.equal(pixels[3], 0, 'Randhintergrund wurde nicht transparent.')
assert.equal(pixels[(4 * 4) + 3], 255, 'Logo-Inhalt wurde fälschlich entfernt.')

console.log('Central PDF logo feature tests passed')
