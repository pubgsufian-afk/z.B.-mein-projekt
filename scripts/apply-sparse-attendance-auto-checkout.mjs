import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function AttendancePage({ session }) {')
const end = source.indexOf('\nfunction EmployeesPage', start)
assert.ok(start >= 0 && end > start, 'AttendancePage wurde nicht gefunden')

const block = source.slice(start, end)
if (block.includes('state.autoCheckoutAt') && block.includes('window.setTimeout')) {
  console.log('sparse attendance auto-checkout UI already applied')
  process.exit(0)
}

const marker = `  useEffect(() => { load() }, [load])\n  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])`
assert.ok(block.includes(marker), 'AttendancePage effect marker wurde nicht gefunden')

const replacement = `${marker}\n  useEffect(() => {\n    const deadline = state.autoCheckoutAt ? new Date(state.autoCheckoutAt) : null\n    const open = ['working', 'paused'].includes(String(state.rawPhase || state.phase || ''))\n    if (!open || !deadline || !Number.isFinite(deadline.getTime())) return undefined\n    const delay = Math.max(0, deadline.getTime() - Date.now() + 250)\n    const timer = window.setTimeout(async () => { await load() }, Math.min(delay, 2147483647))\n    return () => window.clearTimeout(timer)\n  }, [state.autoCheckoutAt, state.rawPhase, state.phase, load])`

source = source.slice(0, start) + block.replace(marker, replacement) + source.slice(end)
await writeFile(path, source)
console.log('sparse attendance auto-checkout UI applied')
