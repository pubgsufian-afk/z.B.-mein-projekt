import { readFile, writeFile } from 'node:fs/promises'

const paths = [
  'netlify/functions/unified-reports.mts',
  'netlify/functions/reports-v2.mts',
]

const helper = `function buildEmployeeFilter(userIds: string[]) {
  if (!userIds.length) return { clause: '', params: [] as string[] }
  const placeholders = userIds.map((_, index) => \`$\${index + 3}\`).join(', ')
  return { clause: \`\n          AND user_id IN ($\{placeholders})\`, params: userIds }
}

`

const oldQuery = `    const events = await sql(
      \`SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date
          AND (cardinality($3::text[]) = 0 OR user_id = ANY($3::text[]))
        ORDER BY user_id, event_date, client_occurred_at\`,
      [from, to, userIds],
    )`

const newQuery = `    const employeeFilter = buildEmployeeFilter(userIds)
    const events = await sql(
      \`SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured
         FROM attendance_events
        WHERE event_date BETWEEN $1::date AND $2::date$\{employeeFilter.clause}
        ORDER BY user_id, event_date, client_occurred_at\`,
      [from, to, ...employeeFilter.params],
    )`

for (const path of paths) {
  let source = await readFile(path, 'utf8')
  if (!source.includes('function buildEmployeeFilter(')) {
    const marker = path.endsWith('unified-reports.mts')
      ? `function hours(minutes: number) {\n  return (Math.max(0, minutes) / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })\n}\n\n`
      : `function hours(minutes: number) {\n  return (minutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })\n}\n\n`
    if (!source.includes(marker)) throw new Error(`Helper-Marker fehlt in ${path}`)
    source = source.replace(marker, marker + helper)
  }
  if (!source.includes(oldQuery)) throw new Error(`Alte Berichtsabfrage fehlt in ${path}`)
  source = source.replace(oldQuery, newQuery)
  await writeFile(path, source)
}

console.log('Report query filter fixed safely')
