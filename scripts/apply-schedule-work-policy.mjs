import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')

if (!source.includes('SCHEDULE_WORK_POLICY_APPLIED')) {
  const coreImportAnchor = `} from './_shared/schedule-assistant-core.mts'\n`
  assert.ok(source.includes(coreImportAnchor), 'Schedule work policy import anchor missing')
  source = source.replace(
    coreImportAnchor,
    `${coreImportAnchor}import { resolveSchedulePause, resolveScheduleWorkArea } from './_shared/schedule-work-policy.mts'\n`,
  )

  const preflightAnchor = `        const publishInput = input as PublishInput\n        const validation = validateAssistantShiftInput(publishInput)`
  assert.ok(source.includes(preflightAnchor), 'Schedule work policy preflight anchor missing')
  source = source.replace(
    preflightAnchor,
    `        const publishInput = input as PublishInput\n        const canonicalWorkArea = resolveScheduleWorkArea(publishInput.workArea)\n        if (!canonicalWorkArea) {\n          preflightFailed = true\n          preflightResults.push({\n            index,\n            employeeName: text(publishInput.employeeName),\n            status: 'invalid',\n            message: 'Bereich ist unbekannt.',\n          })\n          continue\n        }\n        publishInput.workArea = canonicalWorkArea.label\n        const policyPause = resolveSchedulePause({\n          workAreaKey: canonicalWorkArea.key,\n          start: text(publishInput.start),\n          end: text(publishInput.end),\n          explicitPause: publishInput.pauseMinutes,\n        })\n        if (policyPause === null) {\n          preflightFailed = true\n          preflightResults.push({\n            index,\n            employeeName: text(publishInput.employeeName),\n            status: 'invalid',\n            message: 'Pause ist ungültig.',\n          })\n          continue\n        }\n        publishInput.pauseMinutes = policyPause\n        const validation = validateAssistantShiftInput(publishInput)`,
  )

  source += '\n// SCHEDULE_WORK_POLICY_APPLIED\n'
}

assert.match(source, /resolveScheduleWorkArea/)
assert.match(source, /resolveSchedulePause/)
assert.match(source, /publishInput\.workArea = canonicalWorkArea\.label/)
assert.match(source, /publishInput\.pauseMinutes = policyPause/)

await writeFile(path, source)
console.log('Schedule work policy patch applied')
