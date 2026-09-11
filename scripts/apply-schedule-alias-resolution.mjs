import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('SCHEDULE_ALIAS_RESOLUTION_APPLIED')) {
  const coreImportAnchor = `} from './_shared/schedule-assistant-core.mts'\n`
  assert.ok(source.includes(coreImportAnchor), 'Schedule assistant core import anchor missing')
  source = source.replace(
    coreImportAnchor,
    `${coreImportAnchor}import { listEmployeeAliases } from './_shared/employee-alias-service.mts'\nimport { resolveAssistantEmployeeWithAliases } from './_shared/schedule-employee-alias-resolution.mts'\n`,
  )

  const worksitesAnchor = `      const worksites = await activePortalWorksites()\n`
  assert.ok(source.includes(worksitesAnchor), 'Schedule aliases worksite anchor missing')
  source = source.replace(
    worksitesAnchor,
    `      const employeeAliases = await listEmployeeAliases()\n${worksitesAnchor}`,
  )

  const resolutionAnchor = `        const personResolution = resolveAssistantSchedulePerson(\n          publishInput.employeeName,\n          employees,\n          allowUnregistered ? provisionalEmployees : [],\n          allowUnregistered ? approvedUnregisteredNames : [],\n        )`
  assert.ok(source.includes(resolutionAnchor), 'Schedule aliases preflight resolution anchor missing')
  source = source.replace(
    resolutionAnchor,
    `        const registeredResolution = resolveAssistantEmployeeWithAliases(\n          publishInput.employeeName,\n          employees,\n          employeeAliases,\n        )\n        const personResolution = registeredResolution.status === 'matched' && registeredResolution.employee\n          ? {\n              status: 'matched' as const,\n              employee: registeredResolution.employee,\n              candidates: registeredResolution.candidates,\n              provisional: false,\n            }\n          : registeredResolution.status === 'ambiguous'\n            ? {\n                status: 'ambiguous' as const,\n                employee: null,\n                candidates: registeredResolution.candidates,\n                provisional: false,\n              }\n            : resolveAssistantSchedulePerson(\n                publishInput.employeeName,\n                employees,\n                allowUnregistered ? provisionalEmployees : [],\n                allowUnregistered ? approvedUnregisteredNames : [],\n              )`,
  )

  source += '\n// SCHEDULE_ALIAS_RESOLUTION_APPLIED\n'
}

assert.match(source, /listEmployeeAliases/)
assert.match(source, /resolveAssistantEmployeeWithAliases/)
assert.match(source, /const employeeAliases = await listEmployeeAliases\(\)/)

await writeFile(path, source)
console.log('Schedule alias resolution patch applied')
