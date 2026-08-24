const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function parseDateOnly(value) {
  const text = String(value || '').trim()
  if (!ISO_DATE.test(text)) throw new TypeError('Zeitraum ist ungültig.')
  const time = Date.parse(`${text}T12:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== text) {
    throw new TypeError('Zeitraum ist ungültig.')
  }
  return time
}

function dateOnly(time) {
  return new Date(time).toISOString().slice(0, 10)
}

export function minimalDateChunks(from, to, maxInclusiveDays) {
  const start = parseDateOnly(from)
  const end = parseDateOnly(to)
  const maxDays = Number(maxInclusiveDays)
  if (end < start) throw new RangeError('Zeitraum ist ungültig.')
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new RangeError('Chunk-Größe ist ungültig.')

  const chunks = []
  let cursor = start
  while (cursor <= end) {
    const chunkEnd = Math.min(end, cursor + (maxDays - 1) * DAY_MS)
    chunks.push({ from: dateOnly(cursor), to: dateOnly(chunkEnd) })
    cursor = chunkEnd + DAY_MS
  }
  return chunks
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonical(value[key])
  return result
}

function sameProjectedValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

export function changedRowsOnly(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false
    return !sameProjectedValue(row.before, row.after)
  })
}
