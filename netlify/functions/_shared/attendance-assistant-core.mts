export type AttendanceEventSnapshot = {
  id: string
  userId: string
  action: string
  clientOccurredAt: string
  eventDate: string
  scheduleId?: string
}

export type AttendanceEmployeeSnapshot = {
  userId: string
  fullName: string
  status?: string
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeAttendanceName(value: unknown) {
  return text(value).toLocaleLowerCase('de-DE').replace(/\s+/g, ' ')
}

export function detectAttendanceDuplicates(
  events: AttendanceEventSnapshot[],
  employees: AttendanceEmployeeSnapshot[],
) {
  const eventGroups = new Map<string, string[]>()
  for (const event of events) {
    const key = [
      text(event.userId),
      text(event.action),
      text(event.clientOccurredAt),
      text(event.eventDate),
      text(event.scheduleId),
    ].join('|')
    const ids = eventGroups.get(key) || []
    ids.push(text(event.id))
    eventGroups.set(key, ids)
  }

  const exactEvents = [...eventGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([signature, ids]) => ({ signature, eventIds: ids.sort() }))
    .sort((a, b) => a.signature.localeCompare(b.signature))

  const nameGroups = new Map<string, Set<string>>()
  for (const employee of employees) {
    const name = normalizeAttendanceName(employee.fullName)
    if (!name) continue
    const ids = nameGroups.get(name) || new Set<string>()
    ids.add(text(employee.userId))
    nameGroups.set(name, ids)
  }

  const duplicateEmployeeNames = [...nameGroups.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([normalizedName, ids]) => ({ normalizedName, userIds: [...ids].sort() }))
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName))

  const nameByUser = new Map<string, string>()
  for (const employee of employees) {
    const normalizedName = normalizeAttendanceName(employee.fullName)
    if (normalizedName) nameByUser.set(text(employee.userId), normalizedName)
  }
  const byUserDay = new Map<string, AttendanceEventSnapshot[]>()
  for (const event of events) {
    const key = `${text(event.userId)}|${text(event.eventDate)}`
    const items = byUserDay.get(key) || []
    items.push(event)
    byUserDay.set(key, items)
  }
  const sessionGroups = new Map<string, { userId: string; eventIds: string[] }[]>()
  for (const [key, items] of byUserDay) {
    const [userId, eventDate] = key.split('|')
    const normalizedName = nameByUser.get(userId) || userId
    const ordered = [...items].sort((a, b) => text(a.clientOccurredAt).localeCompare(text(b.clientOccurredAt)))
    let start: AttendanceEventSnapshot | null = null
    for (const event of ordered) {
      if (event.action === 'clock-in') {
        start = event
      } else if (event.action === 'clock-out' && start) {
        const signature = [normalizedName, eventDate, text(start.clientOccurredAt), text(event.clientOccurredAt)].join('|')
        const sessions = sessionGroups.get(signature) || []
        sessions.push({ userId, eventIds: [text(start.id), text(event.id)] })
        sessionGroups.set(signature, sessions)
        start = null
      }
    }
  }

  const duplicateSessions = [...sessionGroups.entries()]
    .filter(([, sessions]) => sessions.length > 1)
    .map(([signature, sessions]) => ({
      signature,
      userIds: [...new Set(sessions.map((session) => session.userId))].sort(),
      eventIds: sessions.flatMap((session) => session.eventIds).sort(),
    }))
    .sort((a, b) => a.signature.localeCompare(b.signature))

  return { exactEvents, duplicateEmployeeNames, duplicateSessions }
}

export function validateAttendanceSessionEdit(input: Record<string, unknown>) {
  const clockInAt = new Date(text(input.clockInAt))
  const clockOutAt = new Date(text(input.clockOutAt))
  const pauseMinutes = Number(input.pauseMinutes)
  if (!Number.isFinite(clockInAt.getTime()) || !Number.isFinite(clockOutAt.getTime())) {
    throw new TypeError('Arbeitsbeginn und Arbeitsende müssen gültige Zeitpunkte sein.')
  }
  if (clockOutAt.getTime() < clockInAt.getTime()) {
    throw new RangeError('Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.')
  }
  if (!Number.isFinite(pauseMinutes) || !Number.isInteger(pauseMinutes) || pauseMinutes < 0) {
    throw new TypeError('Die Pause muss eine nichtnegative ganze Minute sein.')
  }
  const grossMinutes = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000)
  if (pauseMinutes > grossMinutes) throw new RangeError('Die Pause darf nicht länger als die Arbeitszeit sein.')
  return {
    clockInAt: clockInAt.toISOString(),
    clockOutAt: clockOutAt.toISOString(),
    pauseMinutes,
  }
}
