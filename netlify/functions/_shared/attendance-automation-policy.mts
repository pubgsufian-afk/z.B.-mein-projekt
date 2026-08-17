import { classifyLocation, distanceMetersBetween } from './attendance-domain.mts'

type Worksite = {
  id?: string
  name?: string
  latitude?: number | null
  longitude?: number | null
  radiusMeters?: number | null
}

type DeviceLocation = {
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
} | null

function asDate(value: string | Date) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('Ungültiger Zeitpunkt.')
  return date
}

export function isFlexClockAccount(email: string, configuredEmail: string) {
  const current = String(email || '').trim().toLowerCase()
  const configured = String(configuredEmail || '').trim().toLowerCase()
  return Boolean(current && configured && current === configured)
}

export function findAllowedWorksite(worksites: Worksite[], location: DeviceLocation) {
  if (!location) return null
  const latitude = Number(location.latitude)
  const longitude = Number(location.longitude)
  const accuracyMeters = Number(location.accuracyMeters)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return null

  let best: { site: Worksite; distance: number } | null = null
  for (const site of Array.isArray(worksites) ? worksites : []) {
    const siteLatitude = Number(site.latitude)
    const siteLongitude = Number(site.longitude)
    if (!site.id || !Number.isFinite(siteLatitude) || !Number.isFinite(siteLongitude)) continue
    const distance = distanceMetersBetween(latitude, longitude, siteLatitude, siteLongitude)
    const classification = classifyLocation(distance, true, true, site.radiusMeters ?? 500, accuracyMeters)
    if (classification.status !== 'inside') continue
    if (!best || distance < best.distance) best = { site, distance }
  }
  return best?.site || null
}

export function flexCheckoutDeadline(clockInAt: string | Date) {
  const date = asDate(clockInAt)
  return new Date(date.getTime() + 12 * 60 * 60 * 1000)
}

export function normalCheckoutDeadline(scheduledEndAt: string | Date) {
  const date = asDate(scheduledEndAt)
  return new Date(date.getTime() + 30 * 60 * 1000)
}

export function autoEventId(action: string, userId: string, deadline: string | Date) {
  const cleanAction = String(action || '').trim()
  const cleanUser = String(userId || '').trim()
  if (!cleanAction || !cleanUser) throw new TypeError('Aktion und Benutzer sind erforderlich.')
  return `auto:${cleanAction}:${cleanUser}:${asDate(deadline).toISOString()}`
}
