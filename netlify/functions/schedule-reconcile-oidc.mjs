import { createCipheriv, randomBytes } from 'node:crypto'
import { verifyScheduleGithubOidc } from './_shared/schedule-github-oidc.mts'
import { decryptScheduleCommandEnvelopeRuntime } from './_shared/schedule-command-envelope-runtime.mts'
import {
  deleteScheduleShift,
  listScheduleShifts,
  upsertScheduleShift,
  writeScheduleAudit,
} from './_shared/schedule-neon-repository.mts'
import { syncPublishedScheduleRange } from './_shared/timesheet-schedule-sync.mts'
import scheduleAssistant from './schedule-assistant.mts'

const MAX_AGE_MS = 30 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

function text(value, max = 200) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

function normalize(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim()
}

function minutes(value) {
  const [hours, mins] = String(value).split(':').map(Number)
  return hours * 60 + mins
}

function validResponseKey(value) {
  try {
    return Buffer.from(text(value), 'base64').length === 32
  } catch {
    return false
  }
}

function encryptResult(data, encodedKey) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('invalid response key')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    version: 1,
    algorithm: 'A256GCM',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

function validateCommand(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid command')
  if (value.version !== 1 || text(value.action) !== 'reconcile-range') throw new Error('invalid action')
  const commandId = text(value.commandId, 160)
  const createdAt = text(value.createdAt, 40)
  const createdMs = Date.parse(createdAt)
  if (!commandId || !Number.isFinite(createdMs)) throw new Error('invalid metadata')
  if (createdMs > now.getTime() + 5 * 60 * 1000 || now.getTime() - createdMs > MAX_AGE_MS) throw new Error('expired command')

  const from = text(value.from, 10)
  const to = text(value.to, 10)
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) throw new Error('invalid range')
  const fromMs = Date.parse(`${from}T12:00:00Z`)
  const toMs = Date.parse(`${to}T12:00:00Z`)
  if ((toMs - fromMs) / 86400000 > 62) throw new Error('range too large')
  if (!validResponseKey(value.responseKey)) throw new Error('invalid response key')

  const protectedEmployees = Array.isArray(value.protectedEmployees) ? value.protectedEmployees : []
  if (protectedEmployees.length > 20) throw new Error('too many protected employees')
  const protectedRows = protectedEmployees.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid protected employee')
    const canonicalName = text(item.canonicalName, 160)
    const aliases = Array.isArray(item.aliases) ? item.aliases.map((alias) => text(alias, 160)).filter(Boolean) : []
    if (!canonicalName) throw new Error('protected canonical name missing')
    return { canonicalName, aliases: [...new Set([canonicalName, ...aliases])] }
  })

  const shifts = Array.isArray(value.shifts) ? value.shifts : []
  if (!shifts.length || shifts.length > 200) throw new Error('invalid shift list')
  const cleanedShifts = shifts.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid shift')
    const employeeName = text(item.employeeName, 160)
    const date = text(item.date, 10)
    const start = text(item.start, 5)
    const end = text(item.end, 5)
    const workArea = text(item.workArea, 160)
    const pauseMinutes = item.pauseMinutes == null || item.pauseMinutes === '' ? 0 : Number(item.pauseMinutes)
    if (!employeeName || !ISO_DATE.test(date) || date < from || date > to || !TIME.test(start) || !TIME.test(end) || minutes(end) <= minutes(start) || !workArea) {
      throw new Error('invalid shift')
    }
    if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0 || pauseMinutes >= minutes(end) - minutes(start)) throw new Error('invalid pause')
    return { employeeName, date, start, end, workArea, pauseMinutes }
  })

  const targetKeys = new Set()
  for (const shift of cleanedShifts) {
    const key = [normalize(shift.employeeName), shift.date, shift.start, shift.end, normalize(shift.workArea)].join('|')
    if (targetKeys.has(key)) throw new Error('duplicate target shift')
    targetKeys.add(key)
  }

  return {
    commandId,
    createdAt: new Date(createdMs).toISOString(),
    from,
    to,
    responseKey: text(value.responseKey),
    protectedEmployees: protectedRows,
    shifts: cleanedShifts,
  }
}

async function callAssistant(body, assistantToken, context) {
  const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }), context)
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
}

function protectedMatch(name, protectedEmployees) {
  const normalized = normalize(name)
  for (const employee of protectedEmployees) {
    if (employee.aliases.some((alias) => normalize(alias) === normalized)) return employee
  }
  return null
}

function shiftKey(row) {
  return [
    normalize(row.employeeName),
    text(row.date, 10),
    text(row.start, 5),
    text(row.end, 5),
    String(Number(row.pauseMinutes || 0)),
    normalize(row.workArea),
  ].join('|')
}

async function deleteRows(rows, commandId) {
  for (const row of rows) {
    const deleted = await deleteScheduleShift(String(row.id))
    if (!deleted) throw new Error('delete failed')
    await writeScheduleAudit({
      actorId: 'dienstplan-assistent',
      actorType: 'chatgpt',
      action: 'shift-deleted',
      shiftId: String(row.id),
      details: {
        requestId: commandId,
        reason: 'encrypted-range-reconcile',
      },
    })
  }
}

async function restoreRows(rows) {
  for (const row of rows) await upsertScheduleShift(row)
}

export default async function scheduleReconcileOidc(request, context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  const body = await request.json().catch(() => null)
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

  try {
    await verifyScheduleGithubOidc(String(body.oidcToken || ''))
  } catch {
    return json({ message: 'Nicht autorisiert.' }, 401)
  }

  const privateKeyDerB64 = String(Netlify.env.get('SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64') || '').trim()
  const assistantToken = String(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || '').trim()
  if (!privateKeyDerB64 || !assistantToken) return json({ message: 'Dienstplan-Verbindung ist nicht konfiguriert.' }, 500)

  let rawCommand
  try {
    rawCommand = decryptScheduleCommandEnvelopeRuntime(body.envelope, Buffer.from(privateKeyDerB64, 'base64'))
  } catch {
    return json({ message: 'Verschlüsselter Dienstplan-Auftrag ist ungültig.' }, 400)
  }

  let command
  try {
    command = validateCommand(rawCommand, new Date())
  } catch {
    return json({ message: 'Dienstplan-Abgleich ist ungültig.' }, 400)
  }

  const encrypted = (payload) => encryptResult(payload, command.responseKey)

  const requestedNames = [...new Set([
    ...command.protectedEmployees.map((entry) => entry.canonicalName),
    ...command.shifts.map((shift) => shift.employeeName),
  ])]
  const resolved = await callAssistant({
    action: 'resolve-employees',
    requestId: command.commandId,
    names: requestedNames,
  }, assistantToken, context)

  if (!resolved.ok) {
    return json({
      employeeCount: 0,
      publishedCount: 0,
      duplicateCount: 0,
      rejectedCount: 1,
      results: [],
      encryptedResult: encrypted({ ok: false, stage: 'resolve', code: 'RESOLVE_FAILED' }),
    })
  }

  const resolutions = Array.isArray(resolved.data?.results) ? resolved.data.results : []
  const unresolved = resolutions.filter((entry) => String(entry?.status || '') !== 'matched')
  if (unresolved.length) {
    return json({
      employeeCount: Number(resolved.data?.directoryDiagnostics?.employeeCount || 0),
      directoryDiagnostics: resolved.data?.directoryDiagnostics || {},
      publishedCount: 0,
      duplicateCount: 0,
      rejectedCount: unresolved.length,
      results: [],
      encryptedResult: encrypted({
        ok: false,
        stage: 'resolve',
        code: 'UNRESOLVED_EMPLOYEES',
        unresolved: unresolved.map((entry) => ({
          inputName: String(entry?.inputName || ''),
          status: String(entry?.status || ''),
          candidates: Array.isArray(entry?.candidates) ? entry.candidates : [],
        })),
      }),
    })
  }

  const current = await listScheduleShifts({ from: command.from, to: command.to })
  const protectedBefore = current.filter((row) => protectedMatch(row.employeeName, command.protectedEmployees))
  const nonProtected = current.filter((row) => !protectedMatch(row.employeeName, command.protectedEmployees))

  const protectedUpdates = []
  for (const row of protectedBefore) {
    const match = protectedMatch(row.employeeName, command.protectedEmployees)
    if (!match || normalize(row.employeeName) === normalize(match.canonicalName)) continue
    const updated = await callAssistant({
      action: 'update-shift',
      requestId: command.commandId,
      shiftId: row.id,
      changes: { employeeName: match.canonicalName },
    }, assistantToken, context)
    if (!updated.ok) {
      for (const before of protectedBefore) await upsertScheduleShift(before)
      return json({
        employeeCount: Number(resolved.data?.directoryDiagnostics?.employeeCount || 0),
        directoryDiagnostics: resolved.data?.directoryDiagnostics || {},
        publishedCount: 0,
        duplicateCount: 0,
        rejectedCount: 1,
        results: [],
        encryptedResult: encrypted({
          ok: false,
          stage: 'protected-name-update',
          code: String(updated.data?.code || 'PROTECTED_UPDATE_FAILED'),
          shiftId: String(row.id),
        }),
      })
    }
    protectedUpdates.push(String(row.id))
  }

  const deletedSnapshot = [...nonProtected]
  const publishedIds = []
  try {
    await deleteRows(nonProtected, command.commandId)

    for (let offset = 0; offset < command.shifts.length; offset += 100) {
      const batch = command.shifts.slice(offset, offset + 100)
      const published = await callAssistant({
        action: 'publish-shifts',
        requestId: `${command.commandId}:${Math.floor(offset / 100)}`,
        shifts: batch,
        allowUnregistered: false,
      }, assistantToken, context)
      if (!published.ok) throw new Error('publish request failed')
      const results = Array.isArray(published.data?.results) ? published.data.results : []
      if (results.length !== batch.length || results.some((entry) => !['published', 'duplicate'].includes(String(entry?.status || '')))) {
        throw new Error('publish batch rejected')
      }
      for (const entry of results) {
        if (String(entry?.status || '') === 'published' && String(entry?.shiftId || '')) publishedIds.push(String(entry.shiftId))
      }
    }
  } catch {
    for (const id of publishedIds) await deleteScheduleShift(id).catch(() => false)
    await restoreRows(deletedSnapshot)
    for (const before of protectedBefore) await upsertScheduleShift(before)
    await syncPublishedScheduleRange(command.from, command.to, 'dienstplan-assistent', new Date()).catch(() => null)
    return json({
      employeeCount: Number(resolved.data?.directoryDiagnostics?.employeeCount || 0),
      directoryDiagnostics: resolved.data?.directoryDiagnostics || {},
      publishedCount: 0,
      duplicateCount: 0,
      rejectedCount: 1,
      results: [],
      encryptedResult: encrypted({ ok: false, stage: 'replace', code: 'REPLACE_FAILED' }),
    })
  }

  const timesheetSync = await syncPublishedScheduleRange(command.from, command.to, 'dienstplan-assistent', new Date())

  const after = await listScheduleShifts({ from: command.from, to: command.to })
  const protectedAfter = after.filter((row) => protectedMatch(row.employeeName, command.protectedEmployees))
  const actualNonProtected = after.filter((row) => !protectedMatch(row.employeeName, command.protectedEmployees))
  const expectedKeys = command.shifts.map(shiftKey).sort()
  const actualKeys = actualNonProtected.map(shiftKey).sort()
  const targetMatches = expectedKeys.length === actualKeys.length && expectedKeys.every((value, index) => value === actualKeys[index])

  const protectedBeforeHours = protectedBefore.map((row) => [
    text(row.date, 10), text(row.start, 5), text(row.end, 5), String(Number(row.pauseMinutes || 0)), normalize(row.workArea), normalize(row.location),
  ].join('|')).sort()
  const protectedAfterHours = protectedAfter.map((row) => [
    text(row.date, 10), text(row.start, 5), text(row.end, 5), String(Number(row.pauseMinutes || 0)), normalize(row.workArea), normalize(row.location),
  ].join('|')).sort()
  const protectedHoursUnchanged = protectedBeforeHours.length === protectedAfterHours.length
    && protectedBeforeHours.every((value, index) => value === protectedAfterHours[index])

  const duplicateCheck = await callAssistant({
    action: 'find-duplicates',
    requestId: `${command.commandId}:verify-duplicates`,
    from: command.from,
    to: command.to,
  }, assistantToken, context)
  const duplicateCount = duplicateCheck.ok ? Number(duplicateCheck.data?.count || 0) : -1
  const ambiguousCount = duplicateCheck.ok && Array.isArray(duplicateCheck.data?.ambiguous)
    ? duplicateCheck.data.ambiguous.length
    : -1

  const verified = targetMatches && protectedHoursUnchanged && duplicateCount === 0 && ambiguousCount === 0
  return json({
    employeeCount: Number(resolved.data?.directoryDiagnostics?.employeeCount || 0),
    directoryDiagnostics: resolved.data?.directoryDiagnostics || {},
    publishedCount: publishedIds.length,
    duplicateCount: duplicateCount < 0 ? 0 : duplicateCount,
    rejectedCount: verified ? 0 : 1,
    results: [],
    encryptedResult: encrypted({
      ok: verified,
      stage: 'verify',
      verified,
      targetMatches,
      protectedHoursUnchanged,
      duplicateCount,
      ambiguousCount,
      deletedCount: nonProtected.length,
      publishedCount: publishedIds.length,
      protectedNameUpdates: protectedUpdates.length,
      finalShiftCount: after.length,
      timesheetSync,
    }),
  })
}

export const config = { path: '/api/schedule-reconcile-oidc' }
