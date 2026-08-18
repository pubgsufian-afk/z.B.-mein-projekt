import type { Config, Context } from '@netlify/functions'
import { verifyScheduleGithubOidc } from './_shared/schedule-github-oidc.mts'
import { decryptScheduleCommandEnvelopeRuntime } from './_shared/schedule-command-envelope-runtime.mts'
import { listScheduleShifts, rebindProvisionalEmployeeIdentity } from './_shared/schedule-neon-repository.mts'
import scheduleAssistant from './schedule-assistant.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function norm(value: unknown) {
  return text(value).toLocaleLowerCase('de-DE').replace(/\s+/g, ' ')
}

async function assistant(body: Record<string, unknown>, context: Context) {
  const token = text(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN'))
  if (!token) return { ok: false, status: 500, data: { message: 'Dienstplan-Verbindung fehlt.' } }
  const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }), context)
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  return { ok: response.ok, status: response.status, data }
}

export default async function scheduleAuditOidc(request: Request, context: Context) {
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)

  try {
    await verifyScheduleGithubOidc(text(body.oidcToken))
  } catch {
    return json({ message: 'Nicht autorisiert.' }, 401)
  }

  const privateKeyDerB64 = text(Netlify.env.get('SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64'))
  if (!privateKeyDerB64) return json({ message: 'Dienstplan-Verbindung fehlt.' }, 500)

  let payload: Record<string, unknown>
  try {
    payload = decryptScheduleCommandEnvelopeRuntime(body.envelope, Buffer.from(privateKeyDerB64, 'base64'))
  } catch {
    return json({ message: 'Verschlüsselter Korrekturauftrag ist ungültig.' }, 400)
  }

  const createdAt = Date.parse(text(payload.createdAt))
  const age = Date.now() - createdAt
  if (payload.version !== 1 || payload.action !== 'correct-by-match' || !Number.isFinite(createdAt) || age < -300000 || age > 1800000) {
    return json({ message: 'Korrekturauftrag ist ungültig oder abgelaufen.' }, 400)
  }

  const operations = Array.isArray(payload.operations) ? payload.operations.slice(0, 100) : []
  if (!operations.length) return json({ message: 'Korrekturen fehlen.' }, 400)

  const results: Array<Record<string, unknown>> = []
  for (let index = 0; index < operations.length; index += 1) {
    const raw = operations[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      results.push({ index, status: 'invalid' })
      continue
    }
    const op = raw as Record<string, unknown>
    const match = op.match && typeof op.match === 'object' && !Array.isArray(op.match)
      ? op.match as Record<string, unknown>
      : {}
    const date = text(match.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      results.push({ index, status: 'invalid' })
      continue
    }

    const all = await listScheduleShifts({ from: date, to: date })
    const matches = all.filter((shift) => {
      if (match.status && text(match.status) !== shift.status) return false
      if (text(match.employeeName) && norm(match.employeeName) !== norm(shift.employeeName)) return false
      if (text(match.employeeUserId) && text(match.employeeUserId) !== shift.employeeUserId) return false
      if (text(match.start) && text(match.start) !== shift.start) return false
      if (text(match.end) && text(match.end) !== shift.end) return false
      if (text(match.workArea) && norm(match.workArea) !== norm(shift.workArea)) return false
      return true
    })

    if (!matches.length) {
      results.push({ index, status: 'not_found' })
      continue
    }
    if (matches.length !== 1) {
      results.push({ index, status: 'ambiguous', count: matches.length })
      continue
    }

    const shift = matches[0]
    if (op.delete === true) {
      const response = await assistant({
        action: 'delete-shift',
        shiftId: shift.id,
        requestId: text(payload.commandId) || crypto.randomUUID(),
      }, context)
      results.push({ index, status: response.ok ? 'deleted' : 'failed', httpStatus: response.status })
      continue
    }

    const changes = op.changes && typeof op.changes === 'object' && !Array.isArray(op.changes)
      ? op.changes as Record<string, unknown>
      : {}
    if (!Object.keys(changes).length) {
      results.push({ index, status: 'invalid' })
      continue
    }

    const oldUserId = shift.employeeUserId
    const response = await assistant({
      action: 'update-shift',
      shiftId: shift.id,
      changes,
      requestId: text(payload.commandId) || crypto.randomUUID(),
    }, context)

    let rebound = false
    if (response.ok && text(changes.employeeName) && oldUserId.startsWith('guest:')) {
      const updated = response.data.shift && typeof response.data.shift === 'object' && !Array.isArray(response.data.shift)
        ? response.data.shift as Record<string, unknown>
        : {}
      const newUserId = text(updated.employeeUserId)
      const newName = text(updated.employeeName)
      if (newUserId && newName && !newUserId.startsWith('guest:')) {
        const result = await rebindProvisionalEmployeeIdentity({
          provisionalUserId: oldUserId,
          userId: newUserId,
          fullName: newName,
          actorId: 'dienstplan-audit',
        })
        rebound = result.rebound === true
      }
    }

    results.push({ index, status: response.ok ? 'updated' : 'failed', httpStatus: response.status, rebound })
  }

  const count = (status: string) => results.filter((entry) => entry.status === status).length
  return json({
    commandId: text(payload.commandId),
    total: results.length,
    updated: count('updated'),
    deleted: count('deleted'),
    notFound: count('not_found'),
    ambiguous: count('ambiguous'),
    failed: count('failed'),
    invalid: count('invalid'),
    rebound: results.filter((entry) => entry.rebound === true).length,
    results,
  })
}

export const config: Config = { path: '/api/schedule-audit-oidc' }
