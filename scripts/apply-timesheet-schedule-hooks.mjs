import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  return source.replace(before, after)
}

const portalPath = 'netlify/functions/schedule-v2-neon.mts'
let portal = await readFile(portalPath, 'utf8')
portal = replaceOnce(
  portal,
  "import { currentPortalActor } from './_shared/portal-role.mts'\n",
  "import { currentPortalActor } from './_shared/portal-role.mts'\nimport { removeScheduleShiftFromTimesheet, syncPublishedScheduleRange, syncPublishedScheduleShift } from './_shared/timesheet-schedule-sync.mts'\n",
  'Portal Timesheet-Sync Import',
)
portal = replaceOnce(
  portal,
  "    const shift = await upsertScheduleShift(candidate)\n    await writeScheduleAudit({",
  "    const shift = await upsertScheduleShift(candidate)\n    await syncPublishedScheduleShift(shift, current.userId, new Date())\n    await writeScheduleAudit({",
  'Portal Dienst speichern',
)
portal = replaceOnce(
  portal,
  "  if (!result.published) return json({ message: 'Für diese Woche ist kein Entwurf vorhanden.' }, 404)\n  await writeScheduleAudit({",
  "  if (!result.published) return json({ message: 'Für diese Woche ist kein Entwurf vorhanden.' }, 404)\n  await syncPublishedScheduleRange(week, addDays(week, 6), current.userId, new Date())\n  await writeScheduleAudit({",
  'Portal Woche veröffentlichen',
)
portal = replaceOnce(
  portal,
  "      await deleteScheduleShift(id)\n      await writeScheduleAudit({ actorId: current.userId, actorType: 'portal', action: 'shift-deleted', shiftId: id })",
  "      await deleteScheduleShift(id)\n      await removeScheduleShiftFromTimesheet(id, existing.date, current.userId, new Date())\n      await writeScheduleAudit({ actorId: current.userId, actorType: 'portal', action: 'shift-deleted', shiftId: id })",
  'Portal Dienst löschen',
)
await writeFile(portalPath, portal)

const assistantPath = 'netlify/functions/schedule-assistant.mts'
let assistant = await readFile(assistantPath, 'utf8')
assistant = replaceOnce(
  assistant,
  "} from './_shared/schedule-neon-repository.mts'\nimport {\n  assistantPersonMatch,",
  "} from './_shared/schedule-neon-repository.mts'\nimport { removeScheduleShiftFromTimesheet, syncPublishedScheduleShift } from './_shared/timesheet-schedule-sync.mts'\nimport {\n  assistantPersonMatch,",
  'Assistent Timesheet-Sync Import',
)
assistant = replaceOnce(
  assistant,
  "    const shift = await upsertScheduleShift(candidate)\n    await writeScheduleAudit({\n      actorId: ACTOR_ID,\n      actorType: 'chatgpt',\n      action: 'shift-published',",
  "    const shift = await upsertScheduleShift(candidate)\n    await syncPublishedScheduleShift(shift, ACTOR_ID, new Date())\n    await writeScheduleAudit({\n      actorId: ACTOR_ID,\n      actorType: 'chatgpt',\n      action: 'shift-published',",
  'Assistent Dienst veröffentlichen',
)
assistant = replaceOnce(
  assistant,
  "  await upsertScheduleShift(candidate)\n  await writeScheduleAudit({\n    actorId: ACTOR_ID,\n    actorType: 'chatgpt',\n    action: 'shift-updated',",
  "  const saved = await upsertScheduleShift(candidate)\n  await syncPublishedScheduleShift(saved, ACTOR_ID, new Date())\n  await writeScheduleAudit({\n    actorId: ACTOR_ID,\n    actorType: 'chatgpt',\n    action: 'shift-updated',",
  'Assistent Dienst ändern',
)
assistant = replaceOnce(
  assistant,
  "  if (!deleted) return json({ message: 'Dienst konnte nicht gelöscht werden.', code: 'DELETE_FAILED' }, 500)\n  await writeScheduleAudit({",
  "  if (!deleted) return json({ message: 'Dienst konnte nicht gelöscht werden.', code: 'DELETE_FAILED' }, 500)\n  await removeScheduleShiftFromTimesheet(shiftId, existing.date, ACTOR_ID, new Date())\n  await writeScheduleAudit({",
  'Assistent Dienst löschen',
)
await writeFile(assistantPath, assistant)

console.log('Timesheet schedule hooks applied')
