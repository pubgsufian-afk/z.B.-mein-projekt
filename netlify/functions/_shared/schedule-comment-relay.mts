export const SCHEDULE_RELAY_MARKER = '<!-- habun-schedule-envelope-v1 -->'
export const SCHEDULE_RELAY_OWNER_ID = 249184348
export const SCHEDULE_RELAY_OWNER_LOGIN = 'pubgsufian-afk'

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function isScheduleRelayComment(comment: any) {
  return Boolean(
    comment
      && typeof comment === 'object'
      && Number(comment?.user?.id) === SCHEDULE_RELAY_OWNER_ID
      && text(comment?.user?.login) === SCHEDULE_RELAY_OWNER_LOGIN
      && String(comment?.body ?? '').startsWith(SCHEDULE_RELAY_MARKER),
  )
}

export function selectScheduleRelayComment(comments: unknown) {
  if (!Array.isArray(comments)) return null
  const matches = comments.filter(isScheduleRelayComment)
  if (!matches.length) return null
  return matches.sort((a: any, b: any) => {
    const aTime = Date.parse(String(a?.created_at ?? '')) || 0
    const bTime = Date.parse(String(b?.created_at ?? '')) || 0
    if (aTime !== bTime) return bTime - aTime
    return Number(b?.id ?? 0) - Number(a?.id ?? 0)
  })[0] || null
}

export function envelopeFromRelayComment(body: unknown) {
  const comment = String(body ?? '')
  if (!comment.startsWith(SCHEDULE_RELAY_MARKER)) throw new Error('Ungültiger Dienstplan-Envelope-Marker')
  const raw = comment.slice(SCHEDULE_RELAY_MARKER.length).trim()
  const envelope = JSON.parse(raw)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Ungültiger Dienstplan-Envelope')
  }
  return envelope as Record<string, unknown>
}
