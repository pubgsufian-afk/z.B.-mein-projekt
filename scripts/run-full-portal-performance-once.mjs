import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')
const timesheet = await readFile('frontend/src/TimesheetPage.jsx', 'utf8')

const finalPerformanceActive =
  app.includes('function DigitalClock() {') &&
  app.includes("dedupeInflightJson('/api/attendance?resource=state'") &&
  app.includes('const entriesByDate = useMemo') &&
  timesheet.includes('const DATE_FORMATTERS = new Map()') &&
  timesheet.includes('dedupeInflightJson(historyPath')

if (finalPerformanceActive) {
  console.log('Full portal performance layer already applied')
} else {
  await import('./apply-full-portal-performance.mjs')
}
