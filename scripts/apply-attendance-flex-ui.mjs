import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function AttendancePage({ session }) {')
const end = source.indexOf('\nfunction EmployeesPage', start)
assert.ok(start >= 0 && end > start, 'AttendancePage wurde nicht gefunden.')
let block = source.slice(start, end)

const eligibilityBlock = `      let visibleState = data
      try {
        const flex = await apiJson('/api/attendance-flex?resource=eligibility')
        if (flex.eligible) {
          // Server resolves eligibility and active flex session from signed-in identity.
          const remoteState = await apiJson('/api/attendance-flex?resource=state')
          visibleState = { ...remoteState, flexEligible: true }
        }
      } catch {
        // A failed exemption check must never unlock normal employees.
      }
      setState(visibleState)`

if (!block.includes('/api/attendance-flex?resource=state')) {
  const marker = '      setState(data)'
  assert.ok(block.includes(marker), 'Attendance-State-Zuweisung wurde nicht gefunden.')
  block = block.replace(marker, eligibilityBlock)
}

const flexEndpointBlock = `      const useFlexEndpoint = Boolean(state.flexEligible) && (action === 'clock-in' || state.flexSession)
      let location = null
      if (!useFlexEndpoint && action === 'clock-in') {
        location = await requestCurrentDeviceLocation()
      } else if (!useFlexEndpoint && action === 'clock-out') {
        try { location = await requestCurrentDeviceLocation() } catch { location = null }
      }
      await apiJson(useFlexEndpoint ? '/api/attendance-flex' : '/api/attendance', {`

if (!block.includes('Boolean(state.flexEligible)')) {
  const marker = `      let location = null
      if (action === 'clock-in') {
        location = await requestCurrentDeviceLocation()
      } else if (action === 'clock-out') {
        try { location = await requestCurrentDeviceLocation() } catch { location = null }
      }
      await apiJson('/api/attendance', {`
  assert.ok(block.includes(marker), 'Attendance-Schreibrequest wurde nicht gefunden.')
  block = block.replace(marker, flexEndpointBlock)
}
source = source.slice(0, start) + block + source.slice(end)
await writeFile(path, source)
console.log('Two-account remote attendance UI applied')
