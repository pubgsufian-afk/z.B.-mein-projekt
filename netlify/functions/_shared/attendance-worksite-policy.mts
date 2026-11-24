// Only trusted, administrator-maintained worksite data may be used for clock-in.
export function coordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function validWorksiteCoordinates(site: { latitude?: unknown; longitude?: unknown } | null | undefined) {
  const latitude = coordinate(site?.latitude, -90, 90)
  const longitude = coordinate(site?.longitude, -180, 180)
  return latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0)
}

function nonnegative(value: unknown): number | null {
  return coordinate(value, 0, Number.MAX_SAFE_INTEGER)
}

export function normalizeRegisteredWorksite(id: string, stored: Record<string, unknown>) {
  if (String(stored.id || '').trim() !== id) return null
  if (!validWorksiteCoordinates(stored)) return null
  const radiusMeters = coordinate(stored.radiusMeters ?? 500, 0, 10000)
  if (radiusMeters === null) return null
  return {
    id,
    latitude: coordinate(stored.latitude, -90, 90)!,
    longitude: coordinate(stored.longitude, -180, 180)!,
    accuracyMeters: nonnegative(stored.accuracyMeters) ?? 0,
    radiusMeters,
  }
}

// The administrator's current registry wins, including an explicit removal of coordinates.
// A missing registry entry may still be a legacy SQL-only worksite; retain that existing path.
export async function resolveAttendanceWorksite(
  id: string,
  lookup: {
    readRegistered: (id: string) => Promise<Record<string, unknown> | null>
    readDatabase: (id: string) => Promise<any>
    ensureDatabaseRow: (site: NonNullable<ReturnType<typeof normalizeRegisteredWorksite>>) => Promise<void>
  },
) {
  const registered = await lookup.readRegistered(id)
  const database = await lookup.readDatabase(id)
  if (!registered) return validWorksiteCoordinates(database) ? database : null
  const site = normalizeRegisteredWorksite(id, registered)
  if (!site) return null
  // Attendance events reference the SQL row; populate it before recording the event.
  if (!database) await lookup.ensureDatabaseRow(site)
  return site
}
