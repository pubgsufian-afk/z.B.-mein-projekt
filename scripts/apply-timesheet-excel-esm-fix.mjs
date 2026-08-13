import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

async function patchExcelImport(path, label) {
  let source = await readFile(path, 'utf8')
  const before = "  const ExcelJS = await import('exceljs')"
  const after = "  const ExcelJSModule = await import('exceljs')\n  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule"
  if (!source.includes(after)) {
    assert.ok(source.includes(before), `${label}: ExcelJS-Import wurde nicht gefunden.`)
    source = source.replace(before, after)
    await writeFile(path, source)
  }
}

async function patchMonthlyReadPath() {
  const apiPath = 'netlify/functions/timesheets.mts'
  let api = await readFile(apiPath, 'utf8')
  const getStart = api.indexOf("if (request.method === 'GET')")
  const getEnd = api.indexOf("if (!['POST', 'PATCH', 'DELETE'].includes(request.method))", getStart)
  assert.ok(getStart >= 0 && getEnd > getStart, 'Monats-Stundenzettel GET-Block wurde nicht gefunden.')
  const block = api.slice(getStart, getEnd)
  const fastBlock = block.replace('      await syncPublishedScheduleRange(from, to, current.userId, now)\n', '')
  if (fastBlock !== block) {
    api = api.slice(0, getStart) + fastBlock + api.slice(getEnd)
    await writeFile(apiPath, api)
  }

  const pagePath = 'frontend/src/TimesheetMonthlyPage.jsx'
  let page = await readFile(pagePath, 'utf8')
  page = page.replace(
    "import { peekCachedJson, refreshCachedJson } from './read-cache.js'",
    "import { dedupeInflightJson, peekCachedJson, refreshCachedJson } from './read-cache.js'",
  )
  const before = "      const data = await requestJson(`/api/timesheets?${params}`)"
  const after = "      const timesheetPath = `/api/timesheets?${params}`\n      const data = await dedupeInflightJson(timesheetPath, () => requestJson(timesheetPath))"
  if (!page.includes(after)) {
    assert.ok(page.includes(before), 'Monats-Stundenzettel Ladeanfrage wurde nicht gefunden.')
    page = page.replace(before, after)
  }
  await writeFile(pagePath, page)
}

async function patchMonthlyReport() {
  const path = 'netlify/functions/timesheet-monthly-reports.mts'
  let source = await readFile(path, 'utf8')
  const syncLine = '    await syncPublishedScheduleRange(from, to, access.current.userId, new Date())\n'
  source = source.replace(syncLine, '')
  await writeFile(path, source)
  await patchExcelImport(path, 'Monats-Stundenzettel')
}

await patchExcelImport('netlify/functions/timesheet-reports.mts', 'Stempelprotokoll')
await Promise.all([patchMonthlyReport(), patchMonthlyReadPath()])
console.log('Stundenzettel Excel-Kompatibilität und schnelle Monatsansicht angewendet')
