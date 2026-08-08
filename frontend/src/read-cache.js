const values = new Map()
const inflight = new Map()

export function peekCachedJson(key) {
  const cacheKey = String(key)
  const entry = values.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    values.delete(cacheKey)
    return undefined
  }
  return entry.value
}

export function primeCachedJson(key, value, ttlMs = 15000) {
  values.set(String(key), {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0),
  })
  return value
}

export async function refreshCachedJson(key, loader, { ttlMs = 15000 } = {}) {
  const cacheKey = String(key)
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)

  const request = Promise.resolve()
    .then(loader)
    .then((value) => primeCachedJson(cacheKey, value, ttlMs))
    .finally(() => inflight.delete(cacheKey))

  inflight.set(cacheKey, request)
  return request
}

export function invalidateCachedJson(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const key of [...values.keys()]) {
      if (keyOrPredicate(key)) values.delete(key)
    }
    return
  }
  values.delete(String(keyOrPredicate))
}

export function clearReadCache() {
  values.clear()
  inflight.clear()
}
