import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let source = await readFile(appPath, 'utf8')

const oldHelper = `function mondayOf(value = new Date()) {
  const date = typeof value === 'string' ? new Date(\`${'${value}'}T12:00:00\`) : new Date(value)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}`

const fixedHelper = `function berlinDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return \`${'${part(\'year\')}-${part(\'month\')}-${part(\'day\')}'}\`
}

function mondayOf(value = new Date()) {
  const explicitDate = typeof value === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : ''
  const dateKey = explicitDate || berlinDateKey(value)
  const date = new Date(\`${'${dateKey}'}T12:00:00Z\`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}`

if (!source.includes(fixedHelper)) {
  assert.ok(source.includes(oldHelper), 'Die bisherige Wochenberechnung wurde nicht gefunden.')
  source = source.replace(oldHelper, fixedHelper)
}

await writeFile(appPath, source)
console.log('Schedule midnight week fix applied')
