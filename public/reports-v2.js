const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

export function reportPeriod(mode, value, from, to) {
  if (mode === 'day') return { from: value, to: value }
  if (mode === 'month') {
    const [year, month] = String(value || '').split('-').map(Number)
    if (!year || !month) throw new TypeError('Monat fehlt')
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  if (!from || !to || to < from) throw new TypeError('Zeitraum ist ungültig')
  return { from, to }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

async function render() {
  const app = window.HabunAttendanceV2
  const section = app?.model?.panel?.querySelector('[data-section="reports"]')
  if (!section || !MANAGEMENT.has(app.model.role)) return
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  section.innerHTML = `
    <article class="habun-v2-card">
      <h3>PDF-Bericht erstellen</h3>
      <form data-report-form>
        <div class="habun-v2-fields">
          <label>Berichtsart<select name="reportType"><option value="employee">Mitarbeiter-Stundennachweis</option><option value="combined">Gesamtübersicht</option></select></label>
          <label>Zeitraum<select name="periodMode"><option value="day">Ein Tag</option><option value="month" selected>Voller Monat</option><option value="range">Freier Zeitraum</option></select></label>
          <label data-period-day hidden>Tag<input type="date" name="day" value="${today}"></label>
          <label data-period-month>Monat<input type="month" name="month" value="${month}"></label>
          <label data-period-range hidden>Von<input type="date" name="from"></label>
          <label data-period-range hidden>Bis<input type="date" name="to"></label>
          <label>Mitarbeiter-IDs<textarea name="userIds" rows="3" placeholder="Leer lassen für alle. Mehrere IDs mit Komma trennen."></textarea></label>
          <label>Ausgabe<select name="outputMode"><option value="combined">Eine gemeinsame PDF</option><option value="separate">Je Mitarbeiter eine PDF</option></select></label>
        </div>
        <div class="habun-v2-actions"><button class="habun-v2-primary" type="submit">PDF erstellen</button></div>
        <p class="habun-v2-status">Die PDF enthält nur den Mitarbeiternamen, geplante und tatsächliche Zeiten, Pause, Nettozeit und Summen. Es gibt keine privaten Daten und keine Unterschriftenfelder.</p>
        <p class="habun-v2-status" data-report-status hidden></p>
      </form>
    </article>`
  const form = section.querySelector('[data-report-form]')
  form.elements.periodMode.addEventListener('change', () => updatePeriodFields(form))
  form.addEventListener('submit', submit)
}

function updatePeriodFields(form) {
  const mode = form.elements.periodMode.value
  form.querySelector('[data-period-day]').hidden = mode !== 'day'
  form.querySelector('[data-period-month]').hidden = mode !== 'month'
  form.querySelectorAll('[data-period-range]').forEach((field) => { field.hidden = mode !== 'range' })
}

async function downloadPdf(payload, filenamePrefix = 'Habun-Bericht') {
  const response = await fetch('/api/reports-v2', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/pdf, application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `Bericht fehlgeschlagen (${response.status})`)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] || `${filenamePrefix}.pdf`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function submit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const target = form.querySelector('[data-report-status]')
  target.hidden = false
  target.dataset.tone = 'info'
  target.textContent = 'Bericht wird erstellt …'
  try {
    const period = reportPeriod(form.elements.periodMode.value, form.elements.periodMode.value === 'day' ? form.elements.day.value : form.elements.month.value, form.elements.from.value, form.elements.to.value)
    const userIds = form.elements.userIds.value.split(',').map((value) => value.trim()).filter(Boolean)
    const base = { reportType: form.elements.reportType.value, ...period }
    if (form.elements.outputMode.value === 'separate' && userIds.length > 1) {
      for (const userId of userIds) await downloadPdf({ ...base, userIds: [userId] }, `Habun-${userId}`)
    } else {
      await downloadPdf({ ...base, userIds })
    }
    target.dataset.tone = 'good'
    target.textContent = 'Bericht wurde erstellt.'
  } catch (error) {
    target.dataset.tone = 'bad'
    target.textContent = escapeHtml(error.message || 'Bericht konnte nicht erstellt werden.')
  }
}

window.addEventListener('habun:v2-ready', (event) => { if (MANAGEMENT.has(event.detail.model.role)) render() })
window.addEventListener('habun:v2-tab', (event) => { if (event.detail.name === 'reports') render() })
