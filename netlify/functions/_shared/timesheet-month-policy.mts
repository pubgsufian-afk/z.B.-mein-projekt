const MONTH_KEY = /^\d{4}-\d{2}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function correctionDeadlineForMonth(monthKey: string) {
  if (!MONTH_KEY.test(monthKey)) throw new TypeError('Ungültiger Monat.')
  const [year, month] = monthKey.split('-').map(Number)
  if (month < 1 || month > 12) throw new TypeError('Ungültiger Monat.')
  const next = new Date(Date.UTC(year, month, 10, 12, 0, 0))
  return next.toISOString().slice(0, 10)
}

export function berlinDateKey(now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Ungültiger Zeitpunkt.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function monthKeyForDate(value: string) {
  if (!ISO_DATE.test(value)) throw new TypeError('Ungültiges Datum.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) throw new TypeError('Ungültiges Datum.')
  return value.slice(0, 7)
}

export function isTimesheetScheduleSyncOpen(monthKey: string, now = new Date()) {
  return berlinDateKey(now) <= correctionDeadlineForMonth(monthKey)
}
