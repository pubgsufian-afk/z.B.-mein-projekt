import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/TimesheetPage.jsx'
let source = await readFile(path, 'utf8')

if (source.includes('const employeeNamesRef = useRef(employeeNames)')) {
  console.log('Stundenzettel duplicate reload prevention already applied')
  process.exit(0)
}

source = source.replace(
  "import { useCallback, useEffect, useMemo, useState } from 'react'",
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
)

const rowsAnchor = "  const rows = useMemo(() => mergeTimesheetRows(actual.rows, planned.rows), [actual.rows, planned.rows])"
const namesLayer = `  const employeeNamesRef = useRef(employeeNames)\n  useEffect(() => { employeeNamesRef.current = employeeNames }, [employeeNames])\n\n  const rebindEmployeeNames = useCallback((current, names) => {\n    let changed = false\n    const rows = current.rows.map((row) => {\n      const nextName = names.get(String(row.userId || ''))\n      if (!nextName || nextName === row.employeeName) return row\n      changed = true\n      return { ...row, employeeName: nextName }\n    })\n    return changed ? { ...current, rows } : current\n  }, [])\n\n  useEffect(() => {\n    setActual((current) => rebindEmployeeNames(current, employeeNames))\n    setPlanned((current) => rebindEmployeeNames(current, employeeNames))\n  }, [employeeNames, rebindEmployeeNames])\n\n${rowsAnchor}`
assert.ok(source.includes(rowsAnchor), 'Stundenzettel-Zeilenanker für lokale Namensbindung fehlt.')
source = source.replace(rowsAnchor, namesLayer)

source = source.replace(
  'buildActualSessions(data.entries || [], employeeNames)',
  'buildActualSessions(data.entries || [], employeeNamesRef.current)',
)
source = source.replace(
  'buildPlannedRows(entries, employeeNames)',
  'buildPlannedRows(entries, employeeNamesRef.current)',
)
source = source.replace(
  '  }, [employeeNames, from, management, to, userId])',
  '  }, [from, management, to, userId])',
)
source = source.replace(
  '  }, [employeeNames, from, management, sessionUserId, to, userId])',
  '  }, [from, management, sessionUserId, to, userId])',
)

await writeFile(path, source)
console.log('Stundenzettel duplicate reload prevention applied')
