import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')
let changed = false

const baseAuth = `  const expectedToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''\n  if (!secureTokenMatches(bearerToken(request), expectedToken)) {`
if (!source.includes(baseAuth)) throw new Error('Schedule assistant token auth marker fehlt')

const publishTypeMarker = `type PublishInput = AssistantShiftInput & {\n  employeeName?: unknown\n}\n`
const diagnosticsType = `type DirectoryDiagnostics = {\n  identityUserCount: number\n  accessCount: number\n  registrationCount: number\n  combinedAccessCount: number\n  employeeCount: number\n  requestedCount: number\n  identityLookupSucceeded: boolean\n}\n`
if (!source.includes('type DirectoryDiagnostics = {')) {
  if (!source.includes(publishTypeMarker)) throw new Error('Schedule diagnostics type marker fehlt')
  source = source.replace(publishTypeMarker, `${publishTypeMarker}\n${diagnosticsType}`)
  changed = true
}

const constantsMarker = `const MAX_BATCH = 100\n`
const diagnosticsStorage = `const MAX_BATCH = 100\nconst directoryDiagnosticsByEmployees = new WeakMap<AssistantDirectoryEmployee[], DirectoryDiagnostics>()\n\nfunction emptyDirectoryDiagnostics(): DirectoryDiagnostics {\n  return {\n    identityUserCount: 0,\n    accessCount: 0,\n    registrationCount: 0,\n    combinedAccessCount: 0,\n    employeeCount: 0,\n    requestedCount: 0,\n    identityLookupSucceeded: false,\n  }\n}\n`
if (!source.includes('directoryDiagnosticsByEmployees')) {
  if (!source.includes(constantsMarker)) throw new Error('Schedule diagnostics storage marker fehlt')
  source = source.replace(constantsMarker, diagnosticsStorage)
  changed = true
}

const diagnosticsMarker = `  if (requestedNames.length) {\n    await writeScheduleAudit({`
const diagnosticsReplacement = `  const directoryDiagnostics: DirectoryDiagnostics = {\n    identityUserCount: identityUsers.length,\n    accessCount: accessRows.length,\n    registrationCount: registrations.length,\n    combinedAccessCount: combinedAccess.length,\n    employeeCount: employees.length,\n    requestedCount: requestedNames.length,\n    identityLookupSucceeded,\n  }\n  directoryDiagnosticsByEmployees.set(employees, directoryDiagnostics)\n\n  if (requestedNames.length) {\n    await writeScheduleAudit({`
if (!source.includes('const directoryDiagnostics: DirectoryDiagnostics = {')) {
  if (!source.includes(diagnosticsMarker)) throw new Error('Schedule diagnostics values marker fehlt')
  source = source.replace(diagnosticsMarker, diagnosticsReplacement)
  changed = true
}

const loadEmployeesMarker = `    const employees = await activePortalEmployees(requestedNames)\n    const action = text(body.action)`
const loadEmployeesReplacement = `    const employees = await activePortalEmployees(requestedNames)\n    const directoryDiagnostics = directoryDiagnosticsByEmployees.get(employees) || emptyDirectoryDiagnostics()\n    const action = text(body.action)`
if (!source.includes(loadEmployeesReplacement)) {
  if (!source.includes(loadEmployeesMarker)) throw new Error('Schedule diagnostics load marker fehlt')
  source = source.replace(loadEmployeesMarker, loadEmployeesReplacement)
  changed = true
}

const resolveResponseMarker = `        role: 'scheduler',\n        results: names.map((name) => publicResolution(name, employees)),`
const resolveResponseReplacement = `        role: 'scheduler',\n        directoryDiagnostics,\n        results: names.map((name) => publicResolution(name, employees)),`
if (!source.includes(resolveResponseReplacement)) {
  if (!source.includes(resolveResponseMarker)) throw new Error('Schedule diagnostics resolve response marker fehlt')
  source = source.replace(resolveResponseMarker, resolveResponseReplacement)
  changed = true
}

const publishResponseMarker = `        role: 'scheduler',\n        requestId,\n        results,`
const publishResponseReplacement = `        role: 'scheduler',\n        requestId,\n        directoryDiagnostics,\n        results,`
if (!source.includes(publishResponseReplacement)) {
  if (!source.includes(publishResponseMarker)) throw new Error('Schedule diagnostics publish response marker fehlt')
  source = source.replace(publishResponseMarker, publishResponseReplacement)
  changed = true
}

const marker = `    const action = text(body.action)\n\n    if (action === 'resolve-employees') {`
const replacement = `    const action = text(body.action)\n\n    if (action === 'sync-directory') {\n      await writeScheduleAudit({\n        actorId: 'dienstplan-assistent',\n        actorType: 'chatgpt',\n        action: 'directory-synced',\n        details: { employeeCount: employees.length },\n      })\n      return json({\n        integration: 'Dienstplan-Assistent',\n        role: 'scheduler',\n        employeeCount: employees.length,\n        directoryDiagnostics,\n      })\n    }\n\n    if (action === 'resolve-employees') {`

if (!source.includes(replacement)) {
  if (!source.includes(marker)) throw new Error('Schedule worker patch marker fehlt in schedule-assistant.mts')
  source = source.replace(marker, replacement)
  changed = true
}

if (changed) {
  await writeFile(path, source)
  console.log('Schedule command worker patch applied')
} else {
  console.log('Schedule command worker patch already applied')
}
