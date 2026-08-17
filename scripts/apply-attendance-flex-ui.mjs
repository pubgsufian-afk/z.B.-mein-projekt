import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function AttendancePage({ session }) {')
const end = source.indexOf('\nfunction EmployeesPage', start)
assert.ok(start >= 0 && end > start, 'AttendancePage wurde nicht gefunden.')
let block = source.slice(start, end)

const eligibilityBlock = `      let visibleState = data
      if (data.phase === 'blocked' && !data.schedule) {
        try {
          const flex = await apiJson('/api/attendance-flex?resource=eligibility')
          if (flex.eligible) visibleState = { ...data, phase: 'idle', clocking: { allowed: true, code: 'FLEX_ACCOUNT' } }
        } catch {}
      }
      setState(visibleState)`

if (!block.includes("/api/attendance-flex?resource=eligibility")) {
  const marker = '      setState(data)'
  assert.ok(block.includes(marker), 'Attendance-State-Zuweisung wurde nicht gefunden.')
  block = block.replace(marker, eligibilityBlock)
}

const flexEndpointBlock = `      const useFlexEndpoint =
        (action === 'clock-in' && state.clocking?.code === 'FLEX_ACCOUNT')
        || (action === 'clock-out' && String(state.schedule?.id || '').startsWith('attendance-flex:'))
      await apiJson(useFlexEndpoint ? '/api/attendance-flex' : '/api/attendance', {`

if (!block.includes("startsWith('attendance-flex:')")) {
  const marker = "      await apiJson('/api/attendance', {"
  assert.ok(block.includes(marker), 'Attendance-Schreibrequest wurde nicht gefunden.')
  block = block.replace(marker, flexEndpointBlock)
}

source = source.slice(0, start) + block + source.slice(end)
await writeFile(path, source)
console.log('Private flex attendance UI applied')
