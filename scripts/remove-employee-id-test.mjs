import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const script = await readFile(new URL('../public/remove-employee-id.js', import.meta.url), 'utf8')
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')

assert.match(index, /remove-employee-id\.js/)
assert.match(script, /Mitarbeiter\[-\\s\]\?ID|Mitarbeiter/)
assert.match(script, /Personalnummer/)
assert.match(script, /employeeId/)
assert.match(script, /employee_id/)
assert.match(script, /required = false/)
assert.match(script, /aria-hidden/)
assert.match(script, /MutationObserver/)

console.log('Employee ID removal tests passed · 8 assertions')
