import type { Config } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { requirePortalRole } from './_shared/portal-role.mts'
import {
  generateTimesheetAdminExport,
  listEmployeeTimesheetRows,
  PortalAdminReportError,
} from './_shared/portal-admin-report-service.mts'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  } })
}

function dateRange(from: unknown, to: unknown) {
  const start = String(from || '')
  const end = String(to || '')
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return null
  const startTime = Date.parse(start + 'T12:00:00Z')
  const endTime = Date.parse(end + 'T12:00:00Z')
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  if (new Date(startTime).toISOString().slice(0, 10) !== start || new Date(endTime).toISOString().slice(0, 10) !== end) return null
  const days = (endTime - startTime) / 86400000
  return days >= 0 && days <= 370 ? { from: start, to: end } : null
}

export default async function employeeTimesheet(request: Request) {
  const access = await requirePortalRole(['owner', 'admin', 'manager', 'employee'])
  if (access.response || !access.current) return access.response
  const userId = access.current.userId // Never accept employee IDs supplied by the browser.
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const range = dateRange(url.searchParams.get('from'), url.searchParams.get('to'))
      if (!range) return json({ message: 'Ungültiger Zeitraum (maximal 371 Tage).' }, 400)
      const rows = await listEmployeeTimesheetRows(userId, range.from, range.to)
      const actual = rows.filter((row) => row.source === 'actual')
      const planned = rows.filter((row) => row.source === 'planned')
      return json({
        entries: rows,
        summary: {
          recordedMinutes: actual.reduce((sum, row) => sum + row.netMinutes, 0),
          scheduledMinutes: planned.reduce((sum, row) => sum + row.netMinutes, 0),
          recordedShifts: actual.length,
          scheduledShifts: planned.length,
        },
      })
    }

    try { verifyRequestOrigin(request) } catch {
      return json({ message: 'Ungültige Anfragequelle.' }, 403)
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ message: 'Ungültige Anfrage.' }, 400)
    const range = dateRange(body.from, body.to)
    if (!range) return json({ message: 'Ungültiger Zeitraum (maximal 371 Tage).' }, 400)
    if (body.format !== 'pdf' && body.format !== 'xlsx') return json({ message: 'Ungültiges Dateiformat.' }, 400)
    const scope = body.scope === 'planned' ? 'planned' : body.scope === 'unified' ? 'unified' : 'actual'
    // Force the authenticated actor's id into the existing report generator.
    const generated = await generateTimesheetAdminExport({
      ...range,
      userIds: [userId],
      scope,
      format: body.format,
    })
    const safeFile = generated.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    return new Response(generated.bytes, {
      status: 200,
      headers: {
        'Content-Type': generated.contentType,
        'Content-Disposition': 'attachment; filename="' + safeFile + '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (error) {
    if (error instanceof PortalAdminReportError) return json({ message: error.message, code: error.code }, error.status)
    console.error('Employee timesheet request failed', error)
    return json({ message: 'Der eigene Stundenzettel ist derzeit nicht verfügbar.' }, 500)
  }
}

export const config: Config = { path: '/api/employee-timesheet' }
