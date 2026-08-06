const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function formatDateTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date) : '–'
}

function decisionLabel(value) {
  if (value === 'approved') return 'Genehmigt'
  if (value === 'rejected') return 'Abgelehnt'
  if (value === 'clarification') return 'Rückfrage'
  return 'Offen'
}

async function load() {
  const app = window.HabunAttendanceV2
  const section = app?.model?.panel?.querySelector('[data-section="corrections"]')
  if (!section) return
  section.innerHTML = '<p class="habun-v2-status">Korrekturen werden geladen …</p>'
  try {
    const payload = await app.jsonFetch('/api/attendance-maintenance?resource=corrections')
    render(section, payload.corrections || [])
  } catch (error) {
    section.innerHTML = `<p class="habun-v2-status" data-tone="bad">${escapeHtml(error.message || 'Korrekturen konnten nicht geladen werden.')}</p>`
  }
}

function render(section, corrections) {
  const app = window.HabunAttendanceV2
  const events = Array.isArray(app.model.state.events) ? app.model.state.events : []
  const eventOptions = events.map((event) => `<option value="${escapeHtml(event.id)}">${event.action === 'clock-in' ? 'Arbeitsbeginn' : 'Arbeitsende'} · ${formatDateTime(event.clientOccurredAt)}</option>`).join('')
  const rows = corrections.map((item) => `
    <tr>
      <td>${formatDateTime(item.occurred_at)}</td>
      <td>${escapeHtml(item.requested_by)}</td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(decisionLabel(item.decision))}</td>
      <td>${escapeHtml(item.decision_reason || '–')}</td>
      ${MANAGEMENT.has(app.model.role) ? `<td><button class="habun-v2-secondary" type="button" data-decide="${escapeHtml(item.id)}">Entscheiden</button></td>` : ''}
    </tr>`).join('')
  section.innerHTML = `
    <article class="habun-v2-card">
      <h3>Korrekturantrag stellen</h3>
      <form data-correction-form>
        <div class="habun-v2-fields">
          <label>Buchung<select name="eventId" required><option value="">Bitte wählen</option>${eventOptions}</select></label>
          <label>Gewünschter Arbeitsbeginn<input type="datetime-local" name="clockInAt"></label>
          <label>Gewünschtes Arbeitsende<input type="datetime-local" name="clockOutAt"></label>
          <label>Gewünschte Pause in Minuten<input type="number" min="0" name="pauseMinutes"></label>
          <label>Bemerkung<textarea name="note" rows="2"></textarea></label>
          <label>Begründung<textarea name="reason" rows="3" required></textarea></label>
        </div>
        <div class="habun-v2-actions"><button class="habun-v2-primary" type="submit">Korrekturantrag senden</button></div>
        <p class="habun-v2-status">Standortdaten können nicht verändert werden. Die ursprüngliche Buchung bleibt unverändert erhalten.</p>
      </form>
    </article>
    <div class="habun-v2-table-wrap"><table class="habun-v2-table"><thead><tr><th>Erstellt</th><th>Konto</th><th>Grund</th><th>Status</th><th>Entscheidungsgrund</th>${MANAGEMENT.has(app.model.role) ? '<th></th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="${MANAGEMENT.has(app.model.role) ? 6 : 5}">Keine Korrekturanträge vorhanden.</td></tr>`}</tbody></table></div>
    ${['owner','admin'].includes(app.model.role) ? `<article class="habun-v2-card"><h3>Aufbewahrung</h3><p>Standortkoordinaten werden nach sechs Monaten, Zeitbuchungen nach 24 Monaten gelöscht, sofern keine rechtliche Sperre besteht.</p><div class="habun-v2-actions"><button type="button" class="habun-v2-secondary" data-retention-dry>Nur prüfen</button><button type="button" class="habun-v2-danger" data-retention-apply>Abgelaufene Daten löschen</button></div><p class="habun-v2-status" data-retention-status hidden></p></article>` : ''}`

  section.querySelector('[data-correction-form]')?.addEventListener('submit', submitRequest)
  section.querySelectorAll('[data-decide]').forEach((button) => button.addEventListener('click', () => decide(button.dataset.decide)))
  section.querySelector('[data-retention-dry]')?.addEventListener('click', () => retention(false))
  section.querySelector('[data-retention-apply]')?.addEventListener('click', () => retention(true))
}

async function submitRequest(event) {
  event.preventDefault()
  const form = event.currentTarget
  const values = Object.fromEntries(new FormData(form).entries())
  const requestedData = {}
  if (values.clockInAt) requestedData.clockInAt = new Date(values.clockInAt).toISOString()
  if (values.clockOutAt) requestedData.clockOutAt = new Date(values.clockOutAt).toISOString()
  if (values.pauseMinutes !== '') requestedData.pauseMinutes = Number(values.pauseMinutes)
  if (values.note) requestedData.note = values.note
  try {
    await window.HabunAttendanceV2.jsonFetch('/api/attendance-maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request-correction', eventId: values.eventId, reason: values.reason, requestedData }),
    })
    window.HabunAttendanceV2.status('Korrekturantrag wurde gesendet.', 'good')
    form.reset()
    await load()
  } catch (error) { window.HabunAttendanceV2.status(error.message, 'bad') }
}

async function decide(correctionId) {
  const decision = window.prompt('Entscheidung eingeben: approved, rejected oder clarification')
  if (!['approved', 'rejected', 'clarification'].includes(String(decision || '').trim())) return
  const reason = window.prompt('Begründung der Entscheidung')
  if (!reason) return
  try {
    await window.HabunAttendanceV2.jsonFetch('/api/attendance-maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decide-correction', correctionId, decision, reason }),
    })
    window.HabunAttendanceV2.status('Entscheidung wurde gespeichert.', 'good')
    await load()
  } catch (error) { window.HabunAttendanceV2.status(error.message, 'bad') }
}

async function retention(apply) {
  if (apply && !window.confirm('Abgelaufene Daten jetzt endgültig löschen? Rechtlich gesperrte Datensätze bleiben erhalten.')) return
  const section = window.HabunAttendanceV2.model.panel.querySelector('[data-section="corrections"]')
  const target = section.querySelector('[data-retention-status]')
  try {
    const result = await window.HabunAttendanceV2.jsonFetch('/api/attendance-maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: apply ? 'retention-apply' : 'retention-dry-run' }),
    })
    target.hidden = false
    target.dataset.tone = apply ? 'good' : 'warn'
    target.textContent = `${apply ? 'Bereinigung abgeschlossen' : 'Prüfung abgeschlossen'} · Standortdatensätze ${result.expiredLocations} · Zeitbuchungen ${result.expiredEvents}`
  } catch (error) {
    target.hidden = false; target.dataset.tone = 'bad'; target.textContent = error.message
  }
}

window.addEventListener('habun:v2-ready', load)
window.addEventListener('habun:v2-tab', (event) => { if (event.detail.name === 'corrections') load() })
