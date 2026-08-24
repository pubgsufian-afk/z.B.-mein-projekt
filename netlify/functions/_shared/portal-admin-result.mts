import type { PortalAdminDomain } from './portal-admin-command-core.mts'

export type PortalAdminItemStatus =
  | 'success'
  | 'duplicate'
  | 'not_found'
  | 'conflict'
  | 'rejected'

export type PortalAdminItemResult = {
  itemId: string
  domain: PortalAdminDomain
  action: string
  status: PortalAdminItemStatus
  code?: string
  data?: unknown
}

export type PortalAdminResult = {
  commandId: string
  domain: PortalAdminDomain
  action: string
  results: PortalAdminItemResult[]
  counts: {
    processed: number
    succeeded: number
    rejected: number
  }
}

export function portalAdminCounts(results: PortalAdminItemResult[]) {
  const succeeded = results.filter((row) => row.status === 'success' || row.status === 'duplicate').length
  return {
    processed: results.length,
    succeeded,
    rejected: results.length - succeeded,
  }
}
