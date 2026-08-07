import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8')
  let changed = false
  for (const { from, to } of replacements) {
    if (source.includes(to)) continue
    if (!source.includes(from)) throw new Error(`Attendance location patch marker fehlt in ${path}: ${from.slice(0, 100)}`)
    source = source.replace(from, to)
    changed = true
  }
  if (changed) await writeFile(path, source)
  return changed
}

const changed = []

if (await patch('netlify/functions/_shared/attendance-service.mts', [
  {
    from: `      const classification = boundaryAction
        ? classifyLocation(distanceMeters, configured, available, object?.radiusMeters ?? 500)
        : { status: 'unavailable', distanceMeters: null }`,
    to: `      const classification = boundaryAction
        ? classifyLocation(distanceMeters, configured, available, object?.radiusMeters ?? 500, payload.location?.accuracyMeters ?? 0)
        : {
            status: 'unavailable', configured: false, available: false, distanceMeters: null,
            radiusMeters: 0, accuracyMeters: 0, accuracyToleranceMeters: 0, allowedDistanceMeters: 0,
          }`,
  },
  {
    from: `      if (boundaryAction && classification.status !== 'inside') {
        if (!configured || !available) {
          throw new AttendanceServiceError(
            'Arbeitsbeginn und Arbeitsende sind nur am gespeicherten Einsatzort mit verfügbarem Standort möglich.',
            422,
            'WORKSITE_LOCATION_REQUIRED',
          )
        }
        throw new AttendanceServiceError(
          'Du befindest dich außerhalb des gespeicherten Einsatzortes. Die Zeitbuchung wurde nicht ausgeführt.',
          403,
          'OUTSIDE_WORKSITE',
        )
      }`,
    to: `      if (boundaryAction && classification.status !== 'inside') {
        if (!configured) {
          throw new AttendanceServiceError(
            'Für diesen Einsatzort sind noch keine gültigen Standort-Koordinaten gespeichert. Bitte den Einsatzort in der Administration öffnen und den aktuellen Standort übernehmen.',
            422,
            'WORKSITE_NOT_CONFIGURED',
          )
        }
        if (!available) {
          throw new AttendanceServiceError(
            'Der Geräte-Standort konnte nicht ermittelt werden. Bitte Standortzugriff für diese Webseite erlauben und erneut versuchen.',
            422,
            'DEVICE_LOCATION_REQUIRED',
          )
        }
        const distanceText = Math.round(Number(classification.distanceMeters) || 0)
        const accuracyText = Math.round(Number(classification.accuracyMeters) || 0)
        const radiusText = Math.round(Number(classification.radiusMeters) || 0)
        const allowedText = Math.round(Number(classification.allowedDistanceMeters) || radiusText)
        throw new AttendanceServiceError(
          \`Du befindest dich außerhalb des gespeicherten Einsatzortes. Entfernung: \${distanceText} m · GPS-Genauigkeit: ±\${accuracyText} m · Einsatzradius: \${radiusText} m · mit GPS-Toleranz erlaubt: \${allowedText} m. Die Zeitbuchung wurde nicht ausgeführt.\`,
          403,
          'OUTSIDE_WORKSITE',
        )
      }`,
  },
])) changed.push('attendance-service.mts')

if (await patch('netlify/functions/attendance.mts', [
  {
    from: `    const repository = await createAttendanceRepository(connectionString)
    const service = createAttendanceService({ repository })`,
    to: `    const baseRepository = await createAttendanceRepository(connectionString)
    const repository = {
      ...baseRepository,
      async findObject(objectId: string) {
        const fromDatabase = await baseRepository.findObject(objectId)
        const databaseConfigured = Boolean(
          fromDatabase && Number.isFinite(Number(fromDatabase.latitude)) && Number.isFinite(Number(fromDatabase.longitude)),
        )
        if (databaseConfigured) return fromDatabase

        const { getStore } = await import('@netlify/blobs')
        const scheduleStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
        const stored = await scheduleStore.get(\`objects/\${objectId}\`, { type: 'json' }) as Record<string, unknown> | null
        if (!stored) return fromDatabase
        const latitude = stored.latitude === '' || stored.latitude == null ? null : Number(stored.latitude)
        const longitude = stored.longitude === '' || stored.longitude == null ? null : Number(stored.longitude)
        return {
          id: String(stored.id || objectId),
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          accuracyMeters: stored.accuracyMeters == null ? null : Number(stored.accuracyMeters),
          radiusMeters: Number.isFinite(Number(stored.radiusMeters)) ? Number(stored.radiusMeters) : 500,
        }
      },
    }
    const service = createAttendanceService({ repository })`,
  },
])) changed.push('attendance.mts')

console.log(changed.length ? `Attendance location fix applied: ${changed.join(', ')}` : 'Attendance location fix already applied')
