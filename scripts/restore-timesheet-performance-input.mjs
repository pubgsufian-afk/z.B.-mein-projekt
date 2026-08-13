import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/TimesheetPage.jsx'
let source = await readFile(path, 'utf8')

if (!source.includes('const employeeNamesRef = useRef(employeeNames)')) {
  console.log('Stundenzettel performance input already canonical')
  process.exit(0)
}

source = source.replace(
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
  "import { useCallback, useEffect, useMemo, useState } from 'react'",
)

const rowsAnchor = "  const rows = useMemo(() => mergeTimesheetRows(actual.rows, planned.rows), [actual.rows, planned.rows])"
const performanceLayer = /  const employeeNamesRef = useRef\(employeeNames\)[\s\S]*?(?=  const rows = useMemo\(\(\) => mergeTimesheetRows\(actual\.rows, planned\.rows\), \[actual\.rows, planned\.rows\]\))/
assert.ok(performanceLayer.test(source), 'Stundenzettel Performance-Zwischenschicht wurde nicht gefunden.')
source = source.replace(performanceLayer, '')
assert.ok(source.includes(rowsAnchor), 'Stundenzettel-Zeilenanker fehlt nach der Normalisierung.')
source = source.replaceAll('employeeNamesRef.current', 'employeeNames')
source = source.replace(
  '  }, [from, management, to, userId])',
  '  }, [employeeNames, from, management, to, userId])',
)
source = source.replace(
  '  }, [from, management, sessionUserId, to, userId])',
  '  }, [employeeNames, from, management, sessionUserId, to, userId])',
)

await writeFile(path, source)
console.log('Stundenzettel performance input restored for repeat verification')
