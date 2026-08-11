import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function OverviewPage({ session, navigate }) {')
const end = source.indexOf('\nfunction DigitalClock', start)
assert.ok(start >= 0 && end > start, 'OverviewPage wurde für die Berlin-Datumskorrektur nicht gefunden.')

let block = source.slice(start, end)
const utcToday = "  const today = new Date().toISOString().slice(0, 10)"
const berlinKeyToday = '  const today = berlinDateKey()'
const berlinHelperToday = '  const today = berlinDate(new Date())'

if (!block.includes(berlinKeyToday)) {
  const utcCount = block.split(utcToday).length - 1
  if (utcCount === 1) {
    block = block.replace(utcToday, berlinKeyToday)
  } else if (block.includes(berlinHelperToday)) {
    block = block.replace(berlinHelperToday, berlinKeyToday)
  } else {
    assert.fail(`Overview-Datum konnte nicht normalisiert werden; UTC-Marker gefunden: ${utcCount}`)
  }
}

// Earlier compatibility patches can re-introduce their own Berlin-local today declaration
// when verify/build runs repeatedly. Keep exactly one canonical declaration.
while (block.includes(berlinHelperToday)) {
  block = block.replace(`${berlinHelperToday}\n`, '')
}

const todayDeclarations = block.match(/\bconst today = /g) || []
assert.equal(todayDeclarations.length, 1, `Overview muss genau eine today-Deklaration haben, gefunden ${todayDeclarations.length}`)
assert.doesNotMatch(block, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/)
assert.match(block, /const today = berlinDateKey\(\)/)

const nextSource = source.slice(0, start) + block + source.slice(end)
if (nextSource !== source) await writeFile(path, nextSource)
console.log('Overview date uses one idempotent Europe/Berlin day key')
