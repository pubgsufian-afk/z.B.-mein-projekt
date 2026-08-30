import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(app, /Dienstplan-PDF herunterladen/, 'Der Von/Bis-PDF-Bereich ist noch nicht deutlich genug beschriftet.')
assert.match(app, /PDF-Zeitraum frei auswählen/, 'Der Hinweis zum frei wählbaren PDF-Zeitraum fehlt.')
assert.match(app, /String\(item\.id\) === String\(objectId\)/, 'Einsatzort-Autofill vergleicht Produktions-IDs noch nicht typsicher.')
assert.match(app, /Schnellwahl Zeit/, 'Die Schnellwahl für häufige Dienstzeiten fehlt.')
assert.match(app, /Schnellwahl Pause/, 'Die Schnellwahl für Pausen fehlt.')
assert.match(app, /Netto-Arbeitszeit/, 'Die Netto-Stundenvorschau im Dienstplan-Editor fehlt.')
assert.match(app, /Alle Werktage/, 'Die einfache Werktagsauswahl für Wiederholungen fehlt.')
assert.match(app, /Arbeitsbereich auswählen/, 'Die Arbeitsbereich-Auswahl fehlt.')
assert.match(app, /status: 'draft'/, 'Die bestehende Entwurfslogik muss erhalten bleiben.')

console.log('Final schedule clarity tests passed')
