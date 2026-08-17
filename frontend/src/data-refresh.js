const REFRESH_EVENT = 'habun:data-refresh'
let installed = false
let cleanup = () => {}

export function requestDataRefresh(reason = 'manual') {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, {
    detail: { reason: String(reason || 'manual'), at: Date.now() },
  }))
}

export function subscribeDataRefresh(listener) {
  const handler = (event) => listener(event.detail || { reason: 'unknown', at: Date.now() })
  window.addEventListener(REFRESH_EVENT, handler)
  return () => window.removeEventListener(REFRESH_EVENT, handler)
}

export function installDataRefreshTriggers({ intervalMs = 60000 } = {}) {
  if (installed) return cleanup
  installed = true
  let lastAutomaticAt = 0

  const emit = (reason, minGapMs = 1500) => {
    const now = Date.now()
    if (now - lastAutomaticAt < minGapMs) return
    lastAutomaticAt = now
    requestDataRefresh(reason)
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') emit('visible')
  }
  const onPageShow = () => emit('pageshow')
  const onFocus = () => {
    if (document.visibilityState !== 'hidden') emit('focus')
  }
  const onServiceWorkerMessage = (event) => {
    if (event.data?.type === 'PORTAL_DATA_CHANGED') emit('push', 0)
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onFocus)
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)

  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') emit('interval', Math.max(0, intervalMs - 1000))
  }, intervalMs)

  cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('focus', onFocus)
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage)
    window.clearInterval(timer)
    installed = false
  }
  return cleanup
}
