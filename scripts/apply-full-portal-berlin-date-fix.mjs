import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function OverviewPage({ session, navigate }) {')
const end = source.indexOf('\nfunction DigitalClock', start)
assert.ok(start >= 0 && end > start, 'OverviewPage wurde für die Berlin-Datumskorrektur nicht gefunden.')

let block = source.slice(start, end)
const utcToday = "  const today = new Date().toISOString().slice(0, 10)"
const berlinToday = '  const today = berlinDateKey()'

if (!block.includes(berlinToday)) {
  const count = block.split(utcToday).length - 1
  assert.equal(count, 1, `Overview-UTC-Datum: erwartete genau einen Marker, gefunden ${count}`)
  block = block.replace(utcToday, berlinToday)
  source = source.slice(0, start) + block + source.slice(end)
  await writeFile(path, source)
}

assert.doesNotMatch(block, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/)
assert.match(block, /const today = berlinDateKey\(\)/)
console.log('Overview date uses Europe/Berlin day key')
