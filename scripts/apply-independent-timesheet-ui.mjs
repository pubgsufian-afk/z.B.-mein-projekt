import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
source = source
  .replace("import TimesheetPage from './TimesheetPage.jsx'\n", '')
  .replace("import TimesheetPage from './TimesheetMonthlyPage.jsx'\n", '')
const reactImport = "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n"
assert.ok(source.includes(reactImport), 'React-Import für Stundenzettel-Routing fehlt.')
source = source.replace(reactImport, `${reactImport}import TimesheetPage from './TimesheetMonthlyPage.jsx'\n`)
await writeFile(path, source)
console.log('Independent monthly timesheet UI routed')
