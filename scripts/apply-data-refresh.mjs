import { readFile, writeFile } from 'node:fs/promises'

function ensureHookImport(source) {
  if (source.includes("from './use-data-refresh.js'")) return source
  const match = source.match(/^import .* from 'react'\n/m)
  if (!match) throw new Error('React import not found while applying data refresh')
  return source.replace(match[0], `${match[0]}import { useDataRefresh } from './use-data-refresh.js'\n`)
}

function subscribeAfterInitialEffect(source, callbackName) {
  const escaped = callbackName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`useEffect\\(\\(\\) => \\{\\s*(?:void\\s+)?${escaped}\\(\\)\\s*\\}, \\[${escaped}\\]\\)`, 'g')
  let cursor = 0
  let output = ''
  let found = false

  for (const match of source.matchAll(pattern)) {
    found = true
    const index = match.index ?? 0
    output += source.slice(cursor, index)
    output += match[0]
    const afterStart = index + match[0].length
    const after = source.slice(afterStart, afterStart + 120)
    if (!new RegExp(`^\\s*useDataRefresh\\(${escaped}\\)`).test(after)) {
      output += `\n  useDataRefresh(${callbackName})`
    }
    cursor = afterStart
  }

  if (!found) return source
  output += source.slice(cursor)
  return output
}

async function patch(path, callbacks) {
  let source = await readFile(path, 'utf8')
  source = ensureHookImport(source)
  for (const callback of callbacks) source = subscribeAfterInitialEffect(source, callback)
  await writeFile(path, source)
}

async function preserveVisibleDataOnError(path, replacements) {
  let source = await readFile(path, 'utf8')
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue
    if (source.includes(before)) source = source.replace(before, after)
  }
  await writeFile(path, source)
}

await patch('frontend/src/App.jsx', ['load', 'reload'])
await patch('frontend/src/TimesheetPage.jsx', ['reload'])
await patch('frontend/src/TimesheetMonthlyPage.jsx', ['loadTimesheet'])
await patch('frontend/src/AdminOverview.jsx', ['loadOverview'])

await preserveVisibleDataOnError('frontend/src/TimesheetPage.jsx', [
  ["      setActual({ rows: [], error: error.message })", "      setActual((current) => ({ rows: current.rows, error: error.message }))"],
  ["      setPlanned({ rows: [], error: error.message })", "      setPlanned((current) => ({ rows: current.rows, error: error.message }))"],
])

await preserveVisibleDataOnError('frontend/src/TimesheetMonthlyPage.jsx', [
  ["      setRows([])\n      setSuppressedRows([])\n      setNotice({ tone: 'error', text: error.message })", "      setNotice({ tone: 'error', text: error.message })"],
])

console.log('Portal data refresh subscriptions applied')
