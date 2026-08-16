import type { PushDeliveryResult } from './push-core.mts'

export function scheduleReminderKey(shiftId: string, scheduledStart: string) {
  const id = String(shiftId || '').trim()
  const instant = new Date(scheduledStart)
  if (!id || !Number.isFinite(instant.getTime())) throw new TypeError('Ungültiger Dienststart für Erinnerung.')
  return `${id}@${instant.toISOString()}`
}

export function shouldReleaseReminderClaim(result: PushDeliveryResult | null) {
  return Boolean(result && result.targeted === 0)
}
