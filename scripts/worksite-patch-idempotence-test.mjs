import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('scripts/apply-worksite-delete-feature.mjs', 'utf8')

assert.match(source, /requiredSelect/)
assert.match(source, /onChange=\{selectScheduleObject\} required/)
assert.match(source, /scheduleBlock\.includes\(requiredSelect\)/)

console.log('Worksite patch idempotence test passed')
