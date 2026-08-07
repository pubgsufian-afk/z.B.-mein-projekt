import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(app, /Dienstplan-PDF herunterladen/, 'Der Von/Bis-PDF-Bereich ist noch nicht deutlich genug beschriftet.')
assert.match(app, /PDF-Zeitraum frei auswählen/, 'Der Hinweis zum frei wählbaren PDF-Zeitraum fehlt.')
assert.match(app, /String\(item\.id\) === String\(objectId\)/, 'Einsatzort-Autofill vergleicht Produktions-IDs noch nicht typsicher.')

console.log('Final schedule clarity tests passed')
