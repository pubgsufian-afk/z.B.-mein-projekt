import { sendPushToUsers, type PushDeliveryResult } from './push-core.mts'

const TITLE = 'Habun Mitarbeiterportal'
const PUBLISHED_BODY = 'Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.'
const CHANGED_BODY = 'Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.'
const STARTING_BODY = 'Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.'

function uniqueUserIds(values: string[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

async function safeSend(label: string, userIds: string[], body: string): Promise<PushDeliveryResult | null> {
  const recipients = uniqueUserIds(userIds)
  if (!recipients.length) return { targeted: 0, delivered: 0, removed: 0, messageId: '' }
  try {
    return await sendPushToUsers({ userIds: recipients, title: TITLE, body, url: '/' })
  } catch (error) {
    console.error(`Schedule push ${label} failed`, error)
    return null
  }
}

export function notifySchedulePublished(userIds: string[]) {
  return safeSend('published', userIds, PUBLISHED_BODY)
}

export function notifyScheduleChanged(userIds: string[]) {
  return safeSend('changed', userIds, CHANGED_BODY)
}

export function notifyShiftStartingSoon(userId: string) {
  return safeSend('starting-soon', [userId], STARTING_BODY)
}
