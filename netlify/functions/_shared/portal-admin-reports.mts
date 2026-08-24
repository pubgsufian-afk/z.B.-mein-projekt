import {
  generateScheduleAdminExport,
  generateTimesheetAdminExport,
  PortalAdminReportError,
} from './portal-admin-report-service.mts'
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

export function createReportsPortalAdminHandler(): PortalAdminHandler {
  return async (operation, context) => {
    try {
      const generated = operation.action === 'timesheet-export'
        ? await generateTimesheetAdminExport(operation.input)
        : operation.action === 'schedule-export'
          ? await generateScheduleAdminExport(operation.input)
          : null

      if (!generated) {
        return {
          itemId: operation.itemId,
          domain: operation.domain,
          action: operation.action,
          status: 'rejected',
          code: 'ACTION_NOT_MAPPED',
        }
      }

      const exported = await spoolPortalAdminExport({
        bytes: generated.bytes,
        responseKey: context.responseKey,
        filename: generated.filename,
        contentType: generated.contentType,
      })
      return {
        itemId: operation.itemId,
        domain: operation.domain,
        action: operation.action,
        status: 'success',
        data: {
          export: exported,
          rowCount: generated.rowCount,
        },
      }
    } catch (error) {
      if (error instanceof PortalAdminReportError || error instanceof PortalAdminExportSpoolError) {
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
