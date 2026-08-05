const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

function monday(value = new Date().toISOString().slice(0, 10)) {
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function minutes(value) {
  const [hours, mins] = String(value || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null
}

export function netShiftMinutes(start, end, pauseMinutes) {
  const from = minutes(start)
  const to = minutes(end)
  const pause = Number(pauseMinutes)
  if (from === null || to === null || to <= from) throw new RangeError('Ungültige Dienstzeit')
  if (!Number.isFinite(pause) || pause < 0 || pause >= to - from) throw new RangeError('Ungültige Pause')
  return to - from - pause
}

export function exactScheduleDuplicate(left, right) {
  const normalize = (value) => String(value || '').trim().toLocaleLowerCase('de')
  return String(left.employeeUserId || '') === String(right.employeeUserId || '')
    && left.date === right.date
    && left.start === right.start
    && left.end === right.end
    && normalize(left.location) === normalize(right.location)
    && normalize(left.workArea) === normalize(right.workArea)
}

function formatHours(totalMinutes) {
  return `${(totalMinutes / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Std.`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

async function load() {
  const app = window.HabunAttendanceV2
  const section = app?.model?.panel?.querySelector('[data-section="schedule"]')
  if (!section || !MANAGEMENT.has(app.model.role)) return
  const week = section.querySelector('[data-schedule-week]')?.value || monday()
  try {
    const [entriesPayload, objectsPayload] = await Promise.all([
      app.jsonFetch(`/api/schedule-v2?resource=entries&from=${week}&to=${addDays(week, 6)}`),
      app.jsonFetch('/api/schedule-v2?resource=objects'),
    ])
    render(section, week, entriesPayload.entries || [], objectsPayload.objects || [])
  } catch (error) {
    section.innerHTML = `<p class="habun-v2-status" data-tone="bad">${escapeHtml(error.message || 'Dienstplan konnte nicht geladen werden.')}</p>`
  }
}

function render(section, week, entries, objects) {
  const rows = entries.map((entry) => {
    let net = '–'
    try { net = formatHours(netShiftMinutes(entry.start, entry.end, entry.pauseMinutes)) } catch {}
    return `<tr data-shift-id="${escapeHtml(entry.id)}">
      <td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.employeeName)}</td><td>${escapeHtml(entry.start)}–${escapeHtml(entry.end)}</td>
      <td>${escapeHtml(entry.location)}<br><small>${escapeHtml(entry.workArea)}</small></td><td>${entry.pauseMinutes} Min.</td><td>${net}</td>
      <td><span class="habun-v2-pill ${entry.status === 'published' ? 'inside' : 'unavailable'}">${entry.status === 'published' ? `Freigegeben v${entry.version}` : 'Entwurf'}</span></td>
      <td><button type="button" class="habun-v2-secondary" data-edit-shift="${escapeHtml(entry.id)}">Bearbeiten</button></td>
    </tr>`
  }).join('')
  const objectOptions = objects.map((object) => `<option value="${escapeHtml(object.id)}" data-name="${escapeHtml(object.name)}">${escapeHtml(object.name)} · ${escapeHtml(object.address)}</option>`).join('')
  section.innerHTML = `
    <div class="habun-v2-fields">
      <label>Woche ab<input type="date" data-schedule-week value="${week}"></label>
    </div>
    <div class="habun-v2-actions">
      <button type="button" class="habun-v2-secondary" data-load-week>Woche laden</button>
      <button type="button" class="habun-v2-secondary" data-copy-week>Vorwoche kopieren</button>
      <button type="button" class="habun-v2-primary" data-publish-week>Entwurf prüfen und freigeben</button>
    </div>
    <article class="habun-v2-card">
      <h3>Dienst anlegen oder bearbeiten</h3>
      <form data-shift-form>
        <input type="hidden" name="id">
        <div class="habun-v2-fields">
          <label>Mitarbeitername<input name="employeeName" required></label>
          <label>Mitarbeiter-ID<input name="employeeUserId" required></label>
          <label>Datum<input type="date" name="date" required value="${week}"></label>
          <label>Von<input type="time" name="start" required></label>
          <label>Bis<input type="time" name="end" required></label>
          <label>Pause<select name="pauseMinutes"><option value="30">30 Minuten</option><option value="45">45 Minuten</option><option value="60">60 Minuten</option><option value="0">Keine</option><option value="custom">Eigene Minuten</option></select></label>
          <label data-custom-pause hidden>Eigene Pause<input type="number" min="0" step="1" name="customPauseMinutes"></label>
          <label>Einsatzort<select name="objectId"><option value="">Ohne Koordinaten</option>${objectOptions}</select></label>
          <label>Einsatzort-Bezeichnung<input name="location" required></label>
          <label>Arbeitsbereich<input name="workArea" required></label>
          <label>Bemerkung<textarea name="note" rows="2"></textarea></label>
        </div>
        <p class="habun-v2-status" data-net-preview>Nettozeit wird nach Eingabe berechnet.</p>
        <div class="habun-v2-actions">
          <button class="habun-v2-primary" type="submit">Als Entwurf speichern</button>
          <button class="habun-v2-secondary" type="button" data-repeat-shift>Auf ausgewählte Tage wiederholen</button>
          <button class="habun-v2-danger" type="button" data-delete-shift hidden>Dienst löschen</button>
          <button class="habun-v2-secondary" type="reset">Formular leeren</button>
        </div>
        <p class="habun-v2-status" data-shift-status hidden></p>
      </form>
    </article>
    ${['owner','admin'].includes(window.HabunAttendanceV2.model.role) ? `<article class="habun-v2-card">
      <h3>Einsatzort mit Standortprüfung</h3>
      <form data-object-form>
        <input type="hidden" name="id">
        <div class="habun-v2-fields">
          <label>Name<input name="name" required></label><label>Adresse<input name="address" required></label>
          <label>Breitengrad<input name="latitude" inputmode="decimal"></label><label>Längengrad<input name="longitude" inputmode="decimal"></label>
          <label>Prüfradius in Metern<input name="radiusMeters" type="number" min="0" max="10000" value="500"></label>
        </div><div class="habun-v2-actions"><button class="habun-v2-primary" type="submit">Einsatzort speichern</button></div>
      </form></article>` : ''}
    <div class="habun-v2-table-wrap"><table class="habun-v2-table"><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Zeit</th><th>Einsatz</th><th>Pause</th><th>Netto</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8">Für diese Woche gibt es noch keine Dienste.</td></tr>'}</tbody></table></div>`

  const weekInput = section.querySelector('[data-schedule-week]')
  section.querySelector('[data-load-week]')?.addEventListener('click', load)
  weekInput?.addEventListener('change', load)
  section.querySelector('[data-copy-week]')?.addEventListener('click', () => postAction({ action: 'copy-previous-week', week: weekInput.value }, 'Die Vorwoche wurde als Entwurf kopiert.'))
  section.querySelector('[data-publish-week]')?.addEventListener('click', async () => {
    if (!window.confirm('Diesen Wochenplan jetzt für Mitarbeiter freigeben?')) return
    await postAction({ action: 'publish', week: weekInput.value }, 'Der Wochenplan wurde freigegeben.')
  })
  const form = section.querySelector('[data-shift-form]')
  const pauseSelect = form.elements.pauseMinutes
  pauseSelect.addEventListener('change', () => {
    form.querySelector('[data-custom-pause]').hidden = pauseSelect.value !== 'custom'
    updatePreview(form)
  })
  ;['start','end','customPauseMinutes'].forEach((name) => form.elements[name]?.addEventListener('input', () => updatePreview(form)))
  form.elements.objectId?.addEventListener('change', () => {
    const selected = form.elements.objectId.selectedOptions[0]
    if (selected?.dataset.name && !form.elements.location.value) form.elements.location.value = selected.dataset.name
  })
  form.addEventListener('submit', saveForm)
  form.addEventListener('reset', () => setTimeout(() => resetForm(form), 0))
  section.querySelectorAll('[data-edit-shift]').forEach((button) => button.addEventListener('click', () => editShift(form, entries.find((entry) => entry.id === button.dataset.editShift))))
  form.querySelector('[data-delete-shift]')?.addEventListener('click', () => deleteCurrent(form))
  form.querySelector('[data-repeat-shift]')?.addEventListener('click', () => repeatCurrent(form))
  section.querySelector('[data-object-form]')?.addEventListener('submit', saveObject)
}

function pauseValue(form) {
  return form.elements.pauseMinutes.value === 'custom'
    ? Number(form.elements.customPauseMinutes.value || 0)
    : Number(form.elements.pauseMinutes.value || 0)
}

function updatePreview(form) {
  const target = form.querySelector('[data-net-preview]')
  try { target.textContent = `Geplante Nettozeit ${formatHours(netShiftMinutes(form.elements.start.value, form.elements.end.value, pauseValue(form)))}` }
  catch { target.textContent = 'Nettozeit wird nach Eingabe berechnet.' }
}

function formPayload(form) {
  return {
    action: 'save', id: form.elements.id.value || undefined,
    employeeName: form.elements.employeeName.value, employeeUserId: form.elements.employeeUserId.value,
    date: form.elements.date.value, start: form.elements.start.value, end: form.elements.end.value,
    pauseMinutes: pauseValue(form), objectId: form.elements.objectId.value,
    location: form.elements.location.value, workArea: form.elements.workArea.value, note: form.elements.note.value,
    status: 'draft',
  }
}

async function saveForm(event) {
  event.preventDefault()
  const form = event.currentTarget
  const status = form.querySelector('[data-shift-status]')
  try {
    const payload = await window.HabunAttendanceV2.jsonFetch('/api/schedule-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formPayload(form)) })
    status.hidden = false
    status.dataset.tone = payload.warnings?.length ? 'warn' : 'good'
    status.textContent = payload.warnings?.length ? `Entwurf gespeichert. Achtung: ${payload.warnings.length} zeitliche Überschneidung(en).` : 'Entwurf gespeichert.'
    await load()
  } catch (error) {
    status.hidden = false; status.dataset.tone = 'bad'; status.textContent = error.message
  }
}

function editShift(form, entry) {
  if (!entry) return
  ;['id','employeeName','employeeUserId','date','start','end','objectId','location','workArea','note'].forEach((name) => { if (form.elements[name]) form.elements[name].value = entry[name] || '' })
  const standard = [0,30,45,60].includes(Number(entry.pauseMinutes))
  form.elements.pauseMinutes.value = standard ? String(entry.pauseMinutes) : 'custom'
  form.elements.customPauseMinutes.value = standard ? '' : entry.pauseMinutes
  form.querySelector('[data-custom-pause]').hidden = standard
  form.querySelector('[data-delete-shift]').hidden = false
  updatePreview(form)
  form.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function resetForm(form) {
  form.elements.id.value = ''
  form.querySelector('[data-delete-shift]').hidden = true
  form.querySelector('[data-custom-pause]').hidden = true
  form.elements.pauseMinutes.value = '30'
  form.elements.date.value = form.closest('[data-section]').querySelector('[data-schedule-week]').value
  updatePreview(form)
}

async function deleteCurrent(form) {
  const id = form.elements.id.value
  if (!id || !window.confirm('Diesen Dienst wirklich löschen?')) return
  await postAction({ action: 'delete', id }, 'Dienst wurde gelöscht.')
}

async function repeatCurrent(form) {
  const id = form.elements.id.value
  if (!id) return window.alert('Speichere den Ausgangsdienst zuerst als Entwurf.')
  const answer = window.prompt('Zieldaten mit Komma trennen, zum Beispiel 2026-08-10,2026-08-12')
  if (!answer) return
  const dates = answer.split(',').map((value) => value.trim()).filter(Boolean)
  await postAction({ action: 'repeat', id, dates }, 'Dienst wurde auf die ausgewählten Tage wiederholt.')
}

async function saveObject(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = Object.fromEntries(new FormData(form).entries())
  await postAction({ action: 'object-upsert', ...data }, 'Einsatzort wurde gespeichert.')
}

async function postAction(payload, message) {
  try {
    await window.HabunAttendanceV2.jsonFetch('/api/schedule-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    window.HabunAttendanceV2.status(message, 'good')
    await load()
  } catch (error) { window.HabunAttendanceV2.status(error.message, 'bad') }
}

window.addEventListener('habun:v2-ready', (event) => { if (MANAGEMENT.has(event.detail.model.role)) load() })
window.addEventListener('habun:v2-tab', (event) => { if (event.detail.name === 'schedule') load() })
