import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const importLine = "import AdminOverview from './AdminOverview.jsx'"

if (!source.includes(importLine)) {
  source = `${importLine}\n${source}`
}

const startMarker = 'function OverviewPage({ session, navigate }) {'
const endMarker = '\nfunction DigitalClock'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker, start)
assert.ok(start >= 0 && end > start, 'OverviewPage konnte für das Admin-Dashboard nicht eindeutig gefunden werden.')

const replacement = `function OverviewPage({ session, navigate }) {
  return <AdminOverview session={session} navigate={navigate} />
}
`

const nextSource = source.slice(0, start) + replacement + source.slice(end)
if (nextSource !== source) await writeFile(path, nextSource)

const verified = await readFile(path, 'utf8')
const overviewBlock = verified.slice(verified.indexOf(startMarker), verified.indexOf(endMarker, verified.indexOf(startMarker)))
assert.match(verified, /import AdminOverview from '\.\/AdminOverview\.jsx'/)
assert.match(overviewBlock, /<AdminOverview session=\{session\} navigate=\{navigate\} \/>/)
assert.doesNotMatch(overviewBlock, /Meine Zeiten/)
assert.doesNotMatch(overviewBlock, /PDF und Excel erstellen/)

await import('./apply-data-refresh.mjs')
await import('./apply-session-expiry-fix.mjs')

console.log('Admin overview + daily report dashboard applied')
