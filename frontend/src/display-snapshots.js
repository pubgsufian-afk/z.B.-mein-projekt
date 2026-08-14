const values = new Map()

export function peekDisplaySnapshot(key) {
  const cacheKey = String(key)
  const entry = values.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    values.delete(cacheKey)
    return undefined
  }
  return entry.value
}

export function setDisplaySnapshot(key, value, ttlMs = 30000) {
  values.set(String(key), {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0),
  })
  return value
}

export function invalidateDisplaySnapshots(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const key of [...values.keys()]) {
      if (keyOrPredicate(key)) values.delete(key)
    }
    return
  }
  values.delete(String(keyOrPredicate))
}

export function clearDisplaySnapshots() {
  values.clear()
}
