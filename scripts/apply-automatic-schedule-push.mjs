import { readFile, writeFile } from 'node:fs/promises'

async function edit(path, transform) {
  const before = await readFile(path, 'utf8')
  const after = transform(before)
  if (after === before) {
    if (before.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED')) return
    throw new Error(`Automatic schedule push patch did not change ${path}`)
  }
  await writeFile(path, after)
}

function insertAfter(source, needle, addition, path) {
  if (!source.includes(needle)) throw new Error(`Missing patch anchor in ${path}: ${needle.slice(0, 80)}`)
  return source.replace(needle, `${needle}${addition}`)
}

await edit('netlify/functions/_shared/push-core.mts', (source) => {
  source = source.replace("const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])\n", '')
  const marker = 'export async function sendPortalPush(options: {'
  const start = source.indexOf(marker)
  if (start < 0) {
    if (source.includes('export async function sendPushToUsers')) return source.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED') ? source : `${source}\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n`
    throw new Error('Missing sendPortalPush in push-core.mts')
  }
  const replacement = `export type PushDeliveryResult = {\n  targeted: number\n  delivered: number\n  removed: number\n  messageId: string\n}\n\nexport async function sendPushToUsers(options: {\n  userIds: string[]\n  title: string\n  body: string\n  url?: string\n}): Promise<PushDeliveryResult> {\n  const userIds = [...new Set(options.userIds.map((value) => String(value || '').trim()).filter(Boolean))]\n  const title = String(options.title || '').trim().slice(0, 80)\n  const body = String(options.body || '').trim().slice(0, 300)\n  const url = String(options.url || '/').trim() || '/'\n  if (!title || !body) throw new TypeError('Titel und Nachricht sind erforderlich.')\n\n  const message: PushMessage = { id: crypto.randomUUID(), title, body, url, createdAt: new Date().toISOString() }\n  if (!userIds.length) return { targeted: 0, delivered: 0, removed: 0, messageId: message.id }\n\n  const recipients = new Set(userIds)\n  const devices = (await listDevices()).filter((row) => recipients.has(row.userId))\n  const config = devices.length ? await vapidConfig() : null\n  let delivered = 0\n  let removed = 0\n\n  for (const device of devices) {\n    const key = \`devices/\${device.tokenHash}\`\n    await store().setJSON(key, { ...device, latestMessage: message, updatedAt: new Date().toISOString() })\n    try {\n      const response = await sendWake(device.endpoint, config!)\n      if (response.ok) delivered += 1\n      else if (response.status === 404 || response.status === 410) {\n        await store().delete(key)\n        removed += 1\n      } else {\n        console.warn('Push service rejected request', response.status, device.endpoint.slice(0, 80))\n      }\n    } catch (error) {\n      console.warn('Push delivery failed', error)\n    }\n  }\n\n  return { targeted: devices.length, delivered, removed, messageId: message.id }\n}\n\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n`
  return source.slice(0, start) + replacement
})

await edit('netlify/functions/push.mts', (source) => {
  source = source.replace('  sendPortalPush,\n', '')
  source = source.replace("const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])\n\n", '')
  const start = source.indexOf("\n  if (action === 'send') {")
  const endMarker = "\n\n  return json({ message: 'Unbekannte Push-Aktion.' }, 400)"
  if (start >= 0) {
    const end = source.indexOf(endMarker, start)
    if (end < 0) throw new Error('Missing manual send end marker in push.mts')
    source = source.slice(0, start) + source.slice(end)
  }
  if (!source.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED')) source += '\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n'
  return source
})

await edit('frontend/src/push-notifications.js', (source) => {
  source = source.replace("const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])\n", '')
  const start = source.indexOf('function mountAdminSender(session) {')
  const end = source.indexOf('function clearPushUi() {', start)
  if (start >= 0 && end > start) source = source.slice(0, start) + source.slice(end)
  source = source.replace("function clearPushUi() {\n  document.querySelector('[data-habun-push-card]')?.remove()\n  document.querySelector('[data-habun-push-admin]')?.remove()\n  document.querySelector('.habun-push-modal-backdrop')?.remove()\n}", "function clearPushUi() {\n  document.querySelector('[data-habun-push-card]')?.remove()\n}")
  source = source.replace('\n  mountAdminSender(session)\n', '\n')
  if (!source.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED')) source += '\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n'
  return source
})

await edit('netlify/functions/schedule-v2-neon.mts', (source) => {
  if (!source.includes("from './_shared/schedule-push.mts'")) {
    source = insertAfter(source, "import { currentPortalActor } from './_shared/portal-role.mts'\n", "import { notifyScheduleChanged, notifySchedulePublished } from './_shared/schedule-push.mts'\n", 'schedule-v2-neon.mts')
  }
  const saveAnchor = "      details: { date: shift.date, employeeUserId: shift.employeeUserId, status: shift.status },\n    })\n"
  if (!source.includes('const changedUserIds = [')) {
    source = insertAfter(source, saveAnchor, "    const changedUserIds = [\n      ...(existing?.status === 'published' ? [existing.employeeUserId] : []),\n      ...(shift.status === 'published' ? [shift.employeeUserId] : []),\n    ]\n    if (changedUserIds.length) await notifyScheduleChanged(changedUserIds)\n", 'schedule-v2-neon.mts save')
  }
  const publishAnchor = "    details: { week, version: result.version, published: result.published },\n  })\n"
  if (!source.includes('publishedShiftIds = new Set(result.shiftIds)')) {
    source = insertAfter(source, publishAnchor, "  const publishedShiftIds = new Set(result.shiftIds)\n  const publishedRows = (await listScheduleShifts({ from: week, to: addDays(week, 6), publishedOnly: true }))\n    .filter((shift) => publishedShiftIds.has(shift.id))\n  await notifySchedulePublished(publishedRows.map((shift) => shift.employeeUserId))\n", 'schedule-v2-neon.mts publish')
  }
  const deleteAnchor = "      await writeScheduleAudit({ actorId: current.userId, actorType: 'portal', action: 'shift-deleted', shiftId: id })\n"
  if (!source.includes('existing.status === \'published\') await notifyScheduleChanged')) {
    source = insertAfter(source, deleteAnchor, "      if (existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])\n", 'schedule-v2-neon.mts delete')
  }
  if (!source.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED')) source += '\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n'
  return source
})

await edit('netlify/functions/schedule-assistant.mts', (source) => {
  if (!source.includes("from './_shared/schedule-push.mts'")) {
    source = insertAfter(source, "import { ensureLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'\n", "import { notifyScheduleChanged, notifySchedulePublished } from './_shared/schedule-push.mts'\n", 'schedule-assistant.mts')
  }
  source = source.replace("      employeeName: shift.employeeName,\n      status: 'published',\n      shiftId: shift.id,", "      employeeName: shift.employeeName,\n      employeeUserId: shift.employeeUserId,\n      status: 'published',\n      shiftId: shift.id,")
  const updateAnchor = "  const verified = await findScheduleShift(candidate.id)\n  if (!verified) return json({ message: 'Geänderter Dienst konnte nicht verifiziert werden.', code: 'VERIFY_FAILED' }, 500)\n"
  if (!source.includes('assistantChangedUserIds')) {
    source = insertAfter(source, updateAnchor, "  const assistantChangedUserIds = [\n    ...(existing.status === 'published' ? [existing.employeeUserId] : []),\n    ...(verified.status === 'published' ? [verified.employeeUserId] : []),\n  ]\n  if (assistantChangedUserIds.length) await notifyScheduleChanged(assistantChangedUserIds)\n", 'schedule-assistant update')
  }
  const deleteAnchor = "    details: { requestId, before: auditShift(existing) },\n  })\n"
  if (!source.includes("existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])")) {
    source = insertAfter(source, deleteAnchor, "  if (existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])\n", 'schedule-assistant delete')
  }
  const batchAnchors = [
    "        results.push(await publishOne(input as PublishInput, index, requestId, employees, worksites, allowUnregistered))\n      }\n",
    "        results.push(await publishOne(input as PublishInput, index, requestId, employees, worksites))\n      }\n",
  ]
  if (!source.includes('publishedUserIds = results.flatMap')) {
    const batchAnchor = batchAnchors.find((candidate) => source.includes(candidate))
    if (!batchAnchor) throw new Error('Missing schedule-assistant batch publication anchor')
    source = insertAfter(source, batchAnchor, "      const publishedUserIds = results.flatMap((entry) =>\n        entry.status === 'published' && 'employeeUserId' in entry ? [String(entry.employeeUserId)] : [],\n      )\n      if (publishedUserIds.length) await notifySchedulePublished(publishedUserIds)\n", 'schedule-assistant batch')
  }
  if (!source.includes('AUTOMATIC_SCHEDULE_PUSH_APPLIED')) source += '\n// AUTOMATIC_SCHEDULE_PUSH_APPLIED\n'
  return source
})

console.log('Automatic schedule push patch applied')
