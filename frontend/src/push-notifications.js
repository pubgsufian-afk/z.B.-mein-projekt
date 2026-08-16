const TOKEN_KEY = 'habunPushDeviceTokenV1'
const MANAGEMENT = new Set(['owner', 'admin', 'manager', 'scheduler'])

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
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
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

  let localRegistration = null
  try { localRegistration = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') } catch {}
  let deviceToken = localRegistration?.userId === userId ? String(localRegistration.token || '') : ''
  if (!deviceToken) {
    const result = await jsonFetch('/api/push', {
      method: 'POST',
      body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON() }),
    })
    deviceToken = String(result.deviceToken || '')
    if (!deviceToken) throw new Error('Das Gerät konnte nicht für Benachrichtigungen registriert werden.')
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: deviceToken, userId }))
  }
  await syncDeviceToken(registration, deviceToken)
  return subscription
}

function mountPermissionCard({ onEnable }) {
  if (document.querySelector('[data-habun-push-card]')) return
  const card = document.createElement('aside')
  card.dataset.habunPushCard = 'true'
  card.className = 'habun-push-card'

  if (isIOS() && !isStandalone()) {
    card.innerHTML = '<div><strong>Benachrichtigungen aktivieren</strong><span>Auf iPhone oder iPad zuerst unten auf Teilen tippen, „Zum Home-Bildschirm“ wählen und das Mitarbeiterportal danach über das neue Symbol öffnen.</span></div><button type="button" data-close aria-label="Hinweis schließen">×</button>'
  } else if (Notification.permission === 'denied') {
    card.innerHTML = '<div><strong>Benachrichtigungen sind ausgeschaltet</strong><span>Bitte in den Geräte- oder Browser-Einstellungen Benachrichtigungen für das Mitarbeiterportal erlauben.</span></div><button type="button" data-close aria-label="Hinweis schließen">×</button>'
  } else {
    card.innerHTML = '<div><strong>Benachrichtigungen aktivieren</strong><span>Erhalte Dienstplan-Änderungen und wichtige Mitteilungen direkt auf diesem Gerät.</span></div><div class="habun-push-card-actions"><button type="button" class="habun-push-enable">Aktivieren</button><button type="button" data-close>Später</button></div>'
    card.querySelector('.habun-push-enable')?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      button.textContent = 'Wird aktiviert …'
      try {
        await onEnable()
        card.remove()
      } catch (error) {
        button.disabled = false
        button.textContent = 'Aktivieren'
        const span = card.querySelector('span')
        if (span) span.textContent = error.message || 'Benachrichtigungen konnten nicht aktiviert werden.'
      }
    })
  }

  card.querySelector('[data-close]')?.addEventListener('click', () => card.remove())
  document.body.appendChild(card)
}

function mountAdminSender(session) {
  if (!MANAGEMENT.has(String(session.role)) || document.querySelector('[data-habun-push-admin]')) return

  const launcher = document.createElement('button')
  launcher.type = 'button'
  launcher.dataset.habunPushAdmin = 'true'
  launcher.className = 'habun-push-launcher'
  launcher.setAttribute('aria-label', 'Benachrichtigung senden')
  launcher.textContent = '🔔'

  const backdrop = document.createElement('div')
  backdrop.className = 'habun-push-modal-backdrop'
  backdrop.hidden = true
  backdrop.innerHTML = `
    <section class="habun-push-modal" role="dialog" aria-modal="true" aria-labelledby="habun-push-title">
      <header><div><span>Mitteilung</span><h3 id="habun-push-title">Benachrichtigung senden</h3></div><button type="button" data-close aria-label="Schließen">×</button></header>
      <label>Empfänger<select data-recipient><option value="">Alle registrierten Geräte</option></select></label>
      <label>Titel<input data-title maxlength="80" value="Habun Mitarbeiterportal"></label>
      <label>Nachricht<textarea data-message maxlength="300" rows="5" placeholder="Nachricht eingeben …"></textarea></label>
      <div class="habun-push-modal-notice" data-notice aria-live="polite"></div>
      <div class="habun-push-modal-actions"><button type="button" data-close>Abbrechen</button><button type="button" class="primary" data-send>Benachrichtigung senden</button></div>
    </section>`

  const close = () => { backdrop.hidden = true }
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close))
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close() })

  let loadedEmployees = false
  launcher.addEventListener('click', async () => {
    backdrop.hidden = false
    if (loadedEmployees) return
    const recipient = backdrop.querySelector('[data-recipient]')
    try {
      const data = await jsonFetch('/api/registrations')
      const employees = Array.isArray(data.employees) ? data.employees : []
      for (const employee of employees) {
        const userId = String(employee.userId || employee.id || '').trim()
        const fullName = String(employee.fullName || employee.name || 'Mitarbeiter').trim()
        if (!userId) continue
        const option = document.createElement('option')
        option.value = userId
        option.textContent = fullName
        recipient.appendChild(option)
      }
      loadedEmployees = true
    } catch {}
  })

  backdrop.querySelector('[data-send]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget
    const notice = backdrop.querySelector('[data-notice]')
    const title = backdrop.querySelector('[data-title]').value.trim()
    const message = backdrop.querySelector('[data-message]').value.trim()
    const targetUserId = backdrop.querySelector('[data-recipient]').value
    if (!title || !message) {
      notice.textContent = 'Bitte Titel und Nachricht eingeben.'
      notice.dataset.tone = 'error'
      return
    }
    button.disabled = true
    button.textContent = 'Wird gesendet …'
    try {
      const result = await jsonFetch('/api/push', {
        method: 'POST',
        body: JSON.stringify({ action: 'send', targetUserId, title, message, url: '/' }),
      })
      notice.textContent = result.targeted
        ? `An ${result.delivered} von ${result.targeted} registrierten Gerät(en) gesendet.`
        : 'Für diesen Empfänger ist noch kein Gerät für Benachrichtigungen aktiviert.'
      notice.dataset.tone = 'success'
      if (result.delivered) backdrop.querySelector('[data-message]').value = ''
    } catch (error) {
      notice.textContent = error.message || 'Die Benachrichtigung konnte nicht gesendet werden.'
      notice.dataset.tone = 'error'
    } finally {
      button.disabled = false
      button.textContent = 'Benachrichtigung senden'
    }
  })

  document.body.append(launcher, backdrop)
}

export async function installPushNotifications() {
  let session
  try { session = await jsonFetch('/api/session') } catch { return }
  if (!session || session.role === 'pending') return

  mountAdminSender(session)

  if (isIOS() && !isStandalone()) {
    mountPermissionCard({ onEnable: async () => {} })
    return
  }

  if (!pushSupported()) return

  const registration = await registerServiceWorker().catch(() => null)
  if (!registration) return

  if (Notification.permission === 'granted') {
    try { await ensureSubscription(registration, false, String(session.userId || session.id || '')) } catch {}
    return
  }

  mountPermissionCard({ onEnable: () => ensureSubscription(registration, true, String(session.userId || session.id || '')) })
}
