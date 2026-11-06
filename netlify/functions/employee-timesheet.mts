import type { Config } from '@netlify/functions'
import { verifyRequestOrigin } from '@netlify/identity'
import { validSelfServiceRange } from './_shared/employee-self-service-policy.mjs'
import { listTimesheetEntries } from './_shared/timesheet-repository.mts'
import { buildPdf as monthlyPdf, buildXlsx as monthlyXlsx } from './timesheet-monthly-reports.mts'
import { rollupDailyTimesheetRows } from '../../shared/timesheet-daily-rollup.mjs'
import { requirePortalRole } from './_shared/portal-role.mts'
import {
  generateTimesheetAdminExport,
  listEmployeeTimesheetRows,
  PortalAdminReportError,
} from './_shared/portal-admin-report-service.mts'

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  } })
}

export default async function employeeTimesheet(request: Request) {
  const access = await requirePortalRole(['owner', 'admin', 'manager', 'employee'])
  if (access.response || !access.current) return access.response
  const userId = access.current.userId // Never accept employee IDs supplied by the browser.
  if (!['GET', 'POST'].includes(request.method)) return json({ message: 'Methode nicht erlaubt.' }, 405)

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const range = validSelfServiceRange(url.searchParams.get('from'), url.searchParams.get('to'))
      if (!range) return json({ message: 'Ungültiger Zeitraum (maximal 371 Tage).' }, 400)
      const [rows, monthlyEntries] = await Promise.all([
        listEmployeeTimesheetRows(userId, range.from, range.to),
        listTimesheetEntries({ from: range.from, to: range.to, employeeUserId: userId }),
      ])
      const actual = rows.filter((row) => row.source === 'actual')
      const planned = rows.filter((row) => row.source === 'planned')
      return json({
        entries: rows,
        monthlyEntries: monthlyEntries.map((row) => ({
          date: row.workDate,
          start: row.start,
          end: row.end,
          pauseMinutes: row.pauseMinutes,
          netMinutes: row.netMinutes,
          location: row.location,
          workArea: row.workArea,
          source: row.source,
          manualOverride: row.manualOverride,
        })),
        summary: {
          timesheetMinutes: monthlyEntries.reduce((sum, row) => sum + row.netMinutes, 0),
          timesheetEntries: monthlyEntries.length,
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
    const range = validSelfServiceRange(body.from, body.to)
    if (!range) return json({ message: 'Ungültiger Zeitraum (maximal 371 Tage).' }, 400)
    if (body.format !== 'pdf' && body.format !== 'xlsx') return json({ message: 'Ungültiges Dateiformat.' }, 400)
    const scope = body.scope === 'monthly' ? 'monthly' : body.scope === 'planned' ? 'planned' : body.scope === 'unified' ? 'unified' : 'actual'
    if (scope === 'monthly') {
      const stored = await listTimesheetEntries({ from: range.from, to: range.to, employeeUserId: userId })
      if (!stored.length) return json({ message: 'Für diesen Monat ist noch kein Stundenzettel hinterlegt.' }, 404)
      const rows = rollupDailyTimesheetRows(stored)
      const bytes = body.format === 'pdf'
        ? await monthlyPdf(request, rows, range.from, range.to)
        : await monthlyXlsx(rows, range.from, range.to)
      return new Response(bytes, { status: 200, headers: {
        'Content-Type': body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Habun-Meine-Stundenzettel-' + range.from + '-bis-' + range.to + '.' + body.format + '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      } })
    }
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
