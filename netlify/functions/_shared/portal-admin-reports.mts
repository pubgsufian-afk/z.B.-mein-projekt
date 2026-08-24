import {
  generateScheduleAdminExport,
  generateTimesheetAdminExport,
  PortalAdminReportError,
} from './portal-admin-report-service.mts'
import {
  createDailyReportAdmin,
  deleteDailyReportAdmin,
  generateDailyReportAdminPdf,
  listDailyReportsAdmin,
  PortalAdminDailyReportError,
  updateDailyReportAdmin,
} from './portal-admin-daily-report-service.mts'
import {
  spoolPortalAdminExport,
  PortalAdminExportSpoolError,
} from './portal-admin-export-spool.mts'
import type { PortalAdminHandler } from './portal-admin-router.mts'

function failureStatus(status: number) {
  if (status === 404) return 'not_found' as const
  if (status === 409 || status === 410 || status === 422) return 'conflict' as const
  return 'rejected' as const
}

async function spoolGenerated(generated: {
  bytes: Uint8Array
  filename: string
  contentType: string
  rowCount: number
}, responseKey: string) {
  const exported = await spoolPortalAdminExport({
    bytes: generated.bytes,
    responseKey,
    filename: generated.filename,
    contentType: generated.contentType,
  })
  return { export: exported, rowCount: generated.rowCount }
}

export function createReportsPortalAdminHandler(): PortalAdminHandler {
  return async (operation, context) => {
    try {
      if (operation.action === 'timesheet-export') {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: await spoolGenerated(await generateTimesheetAdminExport(operation.input), context.responseKey),
        }
      }
      if (operation.action === 'stamp-comparison-export') {
        const generated = await generateTimesheetAdminExport(operation.input)
        const renamed = {
          ...generated,
          filename: generated.filename.replace(/^Habun-Stundenzettel/, 'Habun-Stempelprotokoll'),
        }
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: await spoolGenerated(renamed, context.responseKey),
        }
      }
      if (operation.action === 'schedule-export') {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: await spoolGenerated(await generateScheduleAdminExport(operation.input), context.responseKey),
        }
      }
      if (operation.action === 'daily-list') {
        const reports = await listDailyReportsAdmin(String(operation.input.date || ''))
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: { reports, count: reports.length },
        }
      }
      if (operation.action === 'daily-create') {
        const report = await createDailyReportAdmin(operation.input.text)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { report } }
      }
      if (operation.action === 'daily-update') {
        const report = await updateDailyReportAdmin(operation.input.id, operation.input.text)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data: { report } }
      }
      if (operation.action === 'daily-delete') {
        if (operation.input.confirm !== true) {
          return {
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED',
          }
        }
        const data = await deleteDailyReportAdmin(operation.input.id)
        return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success', data }
      }
      if (operation.action === 'daily-export') {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'success',
          data: await spoolGenerated(await generateDailyReportAdminPdf(operation.input), context.responseKey),
        }
      }
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'rejected',
        code: 'ACTION_NOT_MAPPED',
      }
    } catch (error) {
      if (error instanceof PortalAdminReportError || error instanceof PortalAdminDailyReportError || error instanceof PortalAdminExportSpoolError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: failureStatus(error.status),
          code: error.code,
        }
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'INVALID_REPORT_REQUEST',
        }
      }
      throw error
    }
  }
}
