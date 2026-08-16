import { onAuthChange } from '@netlify/identity'

const TOKEN_KEY = 'habunPushDeviceTokenV1'
const ACTIVE_PORTAL_ROLES = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])
let authListenerInstalled = false

function jsonFetch(path, options = {}) {
  return fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const text = await response.text()
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
    if (!response.ok) throw new Error(body.message || `Anfrage fehlgeschlagen (${response.status}).`)
    return body
  })
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'Notification' in window
}

async function registerServiceWorker() {
  return navigator.serviceWorker.register('/push-sw.js', { scope: '/' })
}

async function syncDeviceToken(registration, token) {
  if (!token) return
  const worker = registration.active || registration.waiting || registration.installing
  worker?.postMessage({ type: 'SET_PUSH_DEVICE_TOKEN', token })
  await navigator.serviceWorker.ready.then((ready) => ready.active?.postMessage({ type: 'SET_PUSH_DEVICE_TOKEN', token })).catch(() => {})
}

function readLocalRegistration(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
    if (value?.userId === userId && value?.token) return value
  } catch {}
  return null
}

async function ensureSubscription(registration, requestPermission, userId) {
  if (requestPermission && Notification.permission === 'default') await Notification.requestPermission()
  if (Notification.permission !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.')

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const { publicKey } = await jsonFetch('/api/push?resource=public-key')
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const localRegistration = readLocalRegistration(userId)
  const result = await jsonFetch('/api/push', {
    method: 'POST',
    body: JSON.stringify({
      action: 'subscribe',
      subscription: subscription.toJSON(),
      deviceToken: localRegistration?.token || '',
    }),
  })
  const deviceToken = String(result.deviceToken || '')
  if (!deviceToken) throw new Error('Das Gerät konnte nicht für Benachrichtigungen registriert werden.')
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: deviceToken, userId }))
  await syncDeviceToken(registration, deviceToken)

  if (requestPermission) {
    await jsonFetch('/api/push', {
      method: 'POST',
      body: JSON.stringify({ action: 'test', deviceToken }),
    })
  }

  return subscription
}

function mountPermissionCard({ onEnable, repair = false }) {
  document.querySelector('[data-habun-push-card]')?.remove()
  const card = document.createElement('aside')
  card.dataset.habunPushCard = 'true'
  card.className = 'habun-push-card'

  if (Notification.permission === 'denied') {
    card.innerHTML = '<div><strong>Benachrichtigungen sind ausgeschaltet</strong><span>Bitte in den iPhone- oder Browser-Einstellungen Benachrichtigungen für das Mitarbeiterportal erlauben.</span></div><button type="button" data-close aria-label="Hinweis schließen">×</button>'
  } else {
    const title = repair ? 'Benachrichtigungen erneut verbinden' : 'Benachrichtigungen aktivieren'
    const text = repair
      ? 'Die Verbindung dieses Geräts muss erneuert werden. Tippe einmal auf „Erneut verbinden“.'
      : 'Erhalte Dienstplan-Änderungen und Erinnerungen vor Dienstbeginn direkt auf diesem Gerät.'
    const buttonText = repair ? 'Erneut verbinden' : 'Aktivieren'
    card.innerHTML = `<div><strong>${title}</strong><span>${text}</span></div><div class="habun-push-card-actions"><button type="button" class="habun-push-enable">${buttonText}</button><button type="button" data-close>Später</button></div>`
    card.querySelector('.habun-push-enable')?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      button.textContent = repair ? 'Wird verbunden …' : 'Wird aktiviert …'
      try {
        await onEnable()
        card.remove()
      } catch (error) {
        button.disabled = false
        button.textContent = buttonText
        const span = card.querySelector('span')
        if (span) span.textContent = error.message || 'Benachrichtigungen konnten nicht aktiviert werden.'
      }
    })
  }

  card.querySelector('[data-close]')?.addEventListener('click', () => card.remove())
  document.body.appendChild(card)
}

function clearPushUi() {
  document.querySelector('[data-habun-push-card]')?.remove()
}

async function setupForCurrentSession() {
  let session
  try { session = await jsonFetch('/api/session') } catch { return }
  if (!session || !ACTIVE_PORTAL_ROLES.has(String(session.role))) return

  if (isIOS() && !isStandalone()) {
    clearPushUi()
    return
  }

  if (!pushSupported()) return

  const registration = await registerServiceWorker().catch(() => null)
  if (!registration?.pushManager) return
  const userId = String(session.userId || session.id || '')

  if (Notification.permission === 'granted') {
    try {
      await ensureSubscription(registration, false, userId)
      clearPushUi()
    } catch {
      mountPermissionCard({
        repair: true,
        onEnable: () => ensureSubscription(registration, false, userId),
      })
    }
    return
  }

  mountPermissionCard({ onEnable: () => ensureSubscription(registration, true, userId) })
}

export async function installPushNotifications() {
  if (!authListenerInstalled) {
    authListenerInstalled = true
    onAuthChange(async (_event, currentUser) => {
      if (!currentUser) {
        clearPushUi()
        return
      }
      await setupForCurrentSession()
    })
  }

  await setupForCurrentSession()
}
