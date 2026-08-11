import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')
const finalPerformanceActive =
  app.includes('function DigitalClock() {') &&
  app.includes("dedupeInflightJson('/api/attendance?resource=state'") &&
  app.includes('const entriesByDate = useMemo')

if (finalPerformanceActive) {
  console.log('Safe performance loading already superseded by full portal performance layer')
} else {
  await import('./apply-safe-performance-loading.mjs')
}
