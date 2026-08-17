const TOKEN_CACHE = 'habun-push-device-v1'
const TOKEN_REQUEST = '/__habun_push_device_token__'

async function saveDeviceToken(token) {
  const cache = await caches.open(TOKEN_CACHE)
  await cache.put(TOKEN_REQUEST, new Response(String(token || ''), { headers: { 'Content-Type': 'text/plain' } }))
}

async function readDeviceToken() {
  const cache = await caches.open(TOKEN_CACHE)
  const response = await cache.match(TOKEN_REQUEST)
  return response ? (await response.text()).trim() : ''
}

async function notifyOpenClientsDataChanged() {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue
    client.postMessage({ type: 'PORTAL_DATA_CHANGED' })
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SET_PUSH_DEVICE_TOKEN') {
    event.waitUntil(saveDeviceToken(event.data.token))
  }
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const token = await readDeviceToken()
    let message = null
    if (token) {
      try {
        const response = await fetch(`/api/push?resource=message&token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        if (response.ok) message = (await response.json())?.message || null
      } catch {}
    }

    await notifyOpenClientsDataChanged()

    const title = message?.title || 'Habun Mitarbeiterportal'
    const body = message?.body || 'Es gibt eine neue Mitteilung im Mitarbeiterportal.'
    const url = message?.url || '/'
    await self.registration.showNotification(title, {
      body,
      icon: '/habun-logo.png',
      badge: '/habun-logo.png',
      tag: message?.id || 'habun-portal-update',
      renotify: Boolean(message?.id),
      data: { url },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue
      if ('navigate' in client) await client.navigate(targetUrl)
      return client.focus()
    }
    return clients.openWindow(targetUrl)
  })())
})
