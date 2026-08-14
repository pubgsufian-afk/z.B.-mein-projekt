import { getStore } from '@netlify/blobs'

export const BERLIN_TIME_ZONE = 'Europe/Berlin'
export const DAILY_REPORT_STORE = 'portal-daily-reports'

export type DailyReport = {
  id: string
  text: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt?: string
  updatedById?: string
  updatedByName?: string
}

export function reportStore() {
  return getStore({ name: DAILY_REPORT_STORE, consistency: 'strong' })
}

export function isIsoDateKey(value: unknown): value is string {
  const text = String(value || '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function berlinDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function safePdfFilenamePart(value: unknown) {
  return String(value || 'Admin')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'Admin'
}

export async function listDailyReports(store = reportStore(), date?: string) {
  const listed = await store.list({ prefix: 'reports/' })
  const rows = await Promise.all(listed.blobs.map(async (blob) => ({
    key: blob.key,
    report: await store.get(blob.key, { type: 'json' }) as DailyReport | null,
  })))
  return rows
    .filter((row): row is { key: string; report: DailyReport } => Boolean(row.report?.id && row.report?.createdAt && row.report?.text))
    .filter((row) => !date || berlinDateKey(row.report.createdAt) === date)
    .sort((left, right) => String(right.report.createdAt).localeCompare(String(left.report.createdAt)))
}

export async function findDailyReportById(store = reportStore(), id: string) {
  if (!id) return null
  const rows = await listDailyReports(store)
  return rows.find((row) => row.report.id === id) || null
}
