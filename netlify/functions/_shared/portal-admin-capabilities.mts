import baseRegistry from '../../../ops/portal-admin-capabilities.json' with { type: 'json' }
import extraRegistry from '../../../ops/portal-admin-capabilities-extra.json' with { type: 'json' }
import type { PortalAdminDomain } from './portal-admin-command-core.mts'

export type PortalAdminCapabilityClassification =
  | 'relay-supported'
  | 'relay-read-only'
  | 'excluded-security'

export type PortalAdminCapability = {
  id: string
  surface: string
  endpoint: string
  method: string
  action: string
  classification: PortalAdminCapabilityClassification
  relay?: {
    domain: PortalAdminDomain
    action: string
  }
  reason?: string
}

const capabilities = [...baseRegistry, ...extraRegistry] as PortalAdminCapability[]

export function portalAdminCapability(domain: PortalAdminDomain, action: string) {
  return capabilities.find((entry) => entry.relay?.domain === domain && entry.relay.action === action)
}

export function portalAdminActionAllowed(domain: PortalAdminDomain, action: string) {
  const capability = portalAdminCapability(domain, action)
  return capability?.classification === 'relay-supported'
    || capability?.classification === 'relay-read-only'
}

export function portalAdminCapabilities() {
  return capabilities.map((entry) => ({ ...entry, relay: entry.relay ? { ...entry.relay } : undefined }))
}
