import { employeeOptions, loadEmployeeDirectory } from './employee-directory-v2.js'

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

function formatDateTime(value) {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : '–'
}

function formatDistance(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return '–'
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`
}

function label(status) {
  if (status === 'inside') return 'Innerhalb'
  if (status === 'outside') return 'Außerhalb'
  return 'Nicht verfügbar'
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function mapLink(location) {
  const lat = Number(location?.latitude)
  const lon = Number(location?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '–'
  const href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`
  return `<a class="habun-v2-map-link" href="${href}" target="_blank" rel="noopener noreferrer">Gespeicherten Punkt öffnen</a>`
}

function groupByUser(entries) {
  const groups = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = entry.userId || 'unbekannt'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  return [...groups.entries()].map(([userId, values]) => ({
    userId,
    values: values.sort((a, b) => String(a.clientOccurredAt).localeCompare(String(b.clientOccurredAt))),
  }))
}

async function render() {
  const app = window.HabunAttendanceV2
  const section = app?.model?.panel?.querySelector('[data-section="live"]')
  if (!section || !MANAGEMENT.has(app.model.role)) return
  try {
    const [directory, workSites] = await Promise.all([
      loadEmployeeDirectory(app.jsonFetch),
      app.jsonFetch('/api/worksite-v2').catch(() => ({ objects: [] })),
    ])
    const siteOptions = (workSites.objects || []).map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)} · ${escapeHtml(site.address || '')}</option>`).join('')
    section.innerHTML = `
      <div class="habun-v2-fields">
        <label>Datum<input type="date" data-live-date value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Einsatzort<select data-live-object><option value="">Alle</option>${siteOptions}</select></label>
        <label>Mitarbeiter<select data-live-user>${employeeOptions(directory.all).replace('Bitte wählen', 'Alle')}</select></label>
        <label>Status<select data-live-status><option value="">Alle</option><option value="inside">Innerhalb</option><option value="outside">Außerhalb</option><option value="unavailable">Nicht verfügbar</option></select></label>
      </div>
      <div class="habun-v2-actions"><button class="habun-v2-secondary" type="button" data-live-load>Live-Stand laden</button></div>
      <div data-live-results><p class="habun-v2-status">Live-Daten werden erst nach Auswahl geladen. Es findet keine Hintergrundortung statt.</p></div>`
    section.querySelector('[data-live-load]')?.addEventListener('click', load)
    await load()
  } catch (error) {
    section.innerHTML = `<p class="habun-v2-status" data-tone="bad">${escapeHtml(error.message || 'Filter konnten nicht geladen werden.')}</p>`
  }
}

async function load() {
  const app = window.HabunAttendanceV2
  const section = app?.model?.panel?.querySelector('[data-section="live"]')
  if (!section) return
  const query = new URLSearchParams({ resource: 'live' })
  const fields = {
    date: section.querySelector('[data-live-date]')?.value,
    objectId: section.querySelector('[data-live-object]')?.value,
    userId: section.querySelector('[data-live-user]')?.value,
    status: section.querySelector('[data-live-status]')?.value,
  }
  for (const [key, value] of Object.entries(fields)) if (String(value || '').trim()) query.set(key, String(value).trim())
  const target = section.querySelector('[data-live-results]')
  target.innerHTML = '<p class="habun-v2-status">Live-Stand wird geladen …</p>'
  try {
    const payload = await app.jsonFetch(`/api/attendance?${query}`)
    const groups = groupByUser(payload.entries)
    target.innerHTML = groups.length ? groups.map(({ userId, values }) => {
      const first = values.find((entry) => entry.action === 'clock-in')
      const last = [...values].reverse().find((entry) => entry.action === 'clock-out')
      const warning = values.some((entry) => entry.locationStatus !== 'inside' || entry.offlineCaptured)
      return `<article class="habun-v2-card habun-v2-live-row" data-alert="${warning}">
        <h3>${escapeHtml(first?.employeeName || last?.employeeName || userId)}</h3>
        <dl class="habun-v2-kv">
          <dt>Arbeitsbeginn</dt><dd>${formatDateTime(first?.clientOccurredAt)}</dd>
          <dt>Arbeitsende</dt><dd>${formatDateTime(last?.clientOccurredAt)}</dd>
          <dt>Einsatzort</dt><dd>${escapeHtml(first?.workSiteName || last?.workSiteName || '–')}</dd>
          <dt>Startstatus</dt><dd><span class="habun-v2-pill ${first?.locationStatus || 'unavailable'}">${label(first?.locationStatus)}</span></dd>
          <dt>Startentfernung</dt><dd>${formatDistance(first?.location?.distanceMeters)}</dd>
          <dt>Startkarte</dt><dd>${mapLink(first?.location)}</dd>
          <dt>Endstatus</dt><dd><span class="habun-v2-pill ${last?.locationStatus || 'unavailable'}">${label(last?.locationStatus)}</span></dd>
          <dt>Endentfernung</dt><dd>${formatDistance(last?.location?.distanceMeters)}</dd>
          <dt>Endkarte</dt><dd>${mapLink(last?.location)}</dd>
          <dt>Offline erfasst</dt><dd>${values.some((entry) => entry.offlineCaptured) ? 'Ja' : 'Nein'}</dd>
          <dt>Genauigkeit</dt><dd>${formatDistance((last || first)?.location?.accuracyMeters)}</dd>
        </dl>
      </article>`
    }).join('') : '<p class="habun-v2-status">Für diese Auswahl liegen keine Zeitbuchungen vor.</p>'
  } catch (error) {
    target.innerHTML = `<p class="habun-v2-status" data-tone="bad">${escapeHtml(error.message || 'Live-Daten konnten nicht geladen werden.')}</p>`
  }
}

window.addEventListener('habun:v2-ready', (event) => {
  if (MANAGEMENT.has(event.detail.model.role)) render()
})
window.addEventListener('habun:v2-tab', (event) => { if (event.detail.name === 'live') render() })
