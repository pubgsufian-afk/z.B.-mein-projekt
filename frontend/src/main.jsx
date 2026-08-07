import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { installAdminTimeEditing } from './admin-time-editing.js'
import './styles.css'
import './mobile-navigation.css'
import './logo-visibility.css'

function isIOSWebKit() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function installIOSPdfPreviewFallback() {
  if (!isIOSWebKit()) return

  let pendingWindow = null
  let pendingTimeout = null

  const closePendingWindow = () => {
    if (pendingWindow && !pendingWindow.closed) pendingWindow.close()
    pendingWindow = null
    if (pendingTimeout) window.clearTimeout(pendingTimeout)
    pendingTimeout = null
  }

  const showLoadingWindow = (previewWindow) => {
    if (!previewWindow) return
    try {
      previewWindow.document.open()
      previewWindow.document.write('<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF-Vorschau</title></head><body style="margin:0;background:#111;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh"><div style="text-align:center;padding:24px"><strong style="font-size:22px">PDF wird erstellt …</strong><p style="color:#b7b7b7">Die Vorschau öffnet sich gleich.</p></div></body></html>')
      previewWindow.document.close()
    } catch {}
  }

  const handlePdfFrame = (frame) => {
    const src = frame?.src || ''
    if (!src.startsWith('blob:')) return

    frame.hidden = true
    let fallback = frame.parentElement?.querySelector('[data-ios-pdf-fallback="true"]')
    if (!fallback) {
      fallback = document.createElement('div')
      fallback.dataset.iosPdfFallback = 'true'
      fallback.setAttribute('role', 'status')
      Object.assign(fallback.style, {
        minHeight: '220px',
        background: '#fff',
        color: '#111',
        borderRadius: '0 0 20px 20px',
        padding: '28px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        textAlign: 'center',
      })
      const title = document.createElement('strong')
      title.textContent = 'PDF-Vorschau ist bereit'
      title.style.fontSize = '20px'
      const text = document.createElement('span')
      text.textContent = 'Auf dem iPhone wird die PDF in der Systemansicht geöffnet, damit sie nicht mehr leer angezeigt wird.'
      text.style.maxWidth = '520px'
      const link = document.createElement('a')
      link.dataset.iosPdfOpen = 'true'
      link.textContent = 'PDF öffnen'
      link.target = '_blank'
      link.rel = 'noopener'
      Object.assign(link.style, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '46px',
        padding: '0 22px',
        borderRadius: '12px',
        background: '#dcb34c',
        color: '#111',
        fontWeight: '800',
        textDecoration: 'none',
      })
      fallback.append(title, text, link)
      frame.insertAdjacentElement('afterend', fallback)
    }

    const link = fallback.querySelector('[data-ios-pdf-open="true"]')
    if (link) link.href = src

    if (pendingWindow && !pendingWindow.closed) {
      try { pendingWindow.location.replace(src) } catch { pendingWindow.location.href = src }
    }
    pendingWindow = null
    if (pendingTimeout) window.clearTimeout(pendingTimeout)
    pendingTimeout = null
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button || !String(button.textContent || '').includes('PDF-Vorschau')) return
    closePendingWindow()
    pendingWindow = window.open('', '_blank')
    showLoadingWindow(pendingWindow)
    pendingTimeout = window.setTimeout(() => {
      if (pendingWindow && !pendingWindow.closed) {
        try {
          pendingWindow.document.body.innerHTML = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px"><strong>Die PDF konnte nicht geöffnet werden.</strong><p>Bitte zurück zum Portal wechseln und die Vorschau erneut starten.</p></div>'
        } catch {}
      }
      pendingWindow = null
      pendingTimeout = null
    }, 30000)
  }, true)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLIFrameElement && mutation.target.classList.contains('pdf-preview')) {
        handlePdfFrame(mutation.target)
      }
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) continue
        if (node.matches?.('iframe.pdf-preview')) handlePdfFrame(node)
        node.querySelectorAll?.('iframe.pdf-preview').forEach(handlePdfFrame)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
}

installIOSPdfPreviewFallback()
installAdminTimeEditing()

const root = document.getElementById('root')
if (!root) throw new Error('Portal-Wurzelelement fehlt.')
createRoot(root).render(<App />)
