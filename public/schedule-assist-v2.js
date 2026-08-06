(() => {
  const MANAGEMENT = new Set(['owner', 'admin', 'manager'])
  let enhancing = false

  function app() { return window.HabunAttendanceV2 }

  async function fetchTemplates() {
    try { return (await app().jsonFetch('/api/schedule-assist-v2?resource=templates')).templates || [] }
    catch { return [] }
  }

  async function enhance() {
    if (enhancing || !app()?.model?.panel || !MANAGEMENT.has(app().model.role)) return
    const form = app().model.panel.querySelector('[data-section="schedule"] [data-shift-form]')
    if (!form || form.dataset.assistReady) return
    enhancing = true
    form.dataset.assistReady = 'true'
    const card = document.createElement('div')
    card.className = 'habun-v2-card'
    card.dataset.scheduleAssist = 'true'
    card.innerHTML = `
      <h3>Planungsassistent</h3>
      <div class="habun-v2-fields">
        <label>Schichtvorlage<select data-template-select><option value="">Keine Vorlage</option></select></label>
      </div>
      <div class="habun-v2-actions">
        <button type="button" class="habun-v2-secondary" data-template-apply>Vorlage anwenden</button>
        <button type="button" class="habun-v2-secondary" data-template-save>Aktuelle Schicht als Vorlage</button>
        <button type="button" class="habun-v2-secondary" data-suggestions-load>Verfügbare Mitarbeiter vorschlagen</button>
      </div>
      <div data-suggestions-results></div>`
    form.prepend(card)
    const templates = await fetchTemplates()
    const select = card.querySelector('[data-template-select]')
    templates.forEach((template) => {
      const option = document.createElement('option')
      option.value = template.id
      option.textContent = template.name
      option.dataset.template = JSON.stringify(template)
      select.append(option)
    })
    card.querySelector('[data-template-apply]')?.addEventListener('click', () => applyTemplate(form, select))
    card.querySelector('[data-template-save]')?.addEventListener('click', () => saveTemplate(form))
    card.querySelector('[data-suggestions-load]')?.addEventListener('click', () => loadSuggestions(form))
    enhancing = false
  }

  function applyTemplate(form, select) {
    const raw = select.selectedOptions[0]?.dataset.template
    if (!raw) return
    const template = JSON.parse(raw)
    for (const name of ['start', 'end', 'location', 'workArea', 'objectId', 'note']) {
      if (form.elements[name]) form.elements[name].value = template[name] || ''
    }
    const pause = Number(template.pauseMinutes || 0)
    if ([0, 30, 45, 60].includes(pause)) form.elements.pauseMinutes.value = String(pause)
    else {
      form.elements.pauseMinutes.value = 'custom'
      form.elements.customPauseMinutes.value = String(pause)
      form.querySelector('[data-custom-pause]').hidden = false
    }
    form.elements.start.dispatchEvent(new Event('input', { bubbles: true }))
  }

  async function saveTemplate(form) {
    const name = window.prompt('Name für diese Schichtvorlage')
    if (!name) return
    const pauseMinutes = form.elements.pauseMinutes.value === 'custom'
      ? Number(form.elements.customPauseMinutes.value || 0)
      : Number(form.elements.pauseMinutes.value || 0)
    try {
      await app().jsonFetch('/api/schedule-assist-v2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-template', name, start: form.elements.start.value, end: form.elements.end.value,
          pauseMinutes, location: form.elements.location.value, workArea: form.elements.workArea.value,
          objectId: form.elements.objectId.value, note: form.elements.note.value,
        }),
      })
      app().status('Schichtvorlage wurde gespeichert.', 'good')
      form.dataset.assistReady = ''
      form.querySelector('[data-schedule-assist]')?.remove()
      enhance()
    } catch (error) { app().status(error.message, 'bad') }
  }

  async function loadSuggestions(form) {
    const target = form.querySelector('[data-suggestions-results]')
    const query = new URLSearchParams({
      resource: 'suggestions', date: form.elements.date.value,
      start: form.elements.start.value, end: form.elements.end.value,
    })
    try {
      const suggestions = (await app().jsonFetch(`/api/schedule-assist-v2?${query}`)).suggestions || []
      target.innerHTML = suggestions.length ? `<div class="habun-v2-actions">${suggestions.map((item) => `<button type="button" class="habun-v2-secondary" data-suggest-user="${item.employeeUserId}" data-suggest-name="${item.employeeName}" ${item.available ? '' : 'disabled'}>${item.employeeName}${item.available ? ' · verfügbar' : ' · belegt'}</button>`).join('')}</div>` : '<p class="habun-v2-status">Noch keine bekannten Mitarbeiter für Vorschläge vorhanden.</p>'
      target.querySelectorAll('[data-suggest-user]').forEach((button) => button.addEventListener('click', () => {
        form.elements.employeeUserId.value = button.dataset.suggestUser
        form.elements.employeeName.value = button.dataset.suggestName
      }))
    } catch (error) { target.innerHTML = `<p class="habun-v2-status" data-tone="bad">${error.message}</p>` }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-publish-week]')
    if (!button || button.dataset.reviewBypass === 'true') return
    event.preventDefault()
    event.stopImmediatePropagation()
    const section = button.closest('[data-section="schedule"]')
    const week = section?.querySelector('[data-schedule-week]')?.value
    try {
      const review = await app().jsonFetch(`/api/schedule-assist-v2?resource=review&week=${encodeURIComponent(week)}`)
      const message = `Woche ${review.week}\nDienste: ${review.shiftCount}\nEntwürfe: ${review.draftCount}\nZeitliche Warnungen: ${review.conflicts.length}\n\nJetzt freigeben?`
      if (!window.confirm(message)) return
      await app().jsonFetch('/api/schedule-v2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', week }),
      })
      app().status('Der geprüfte Wochenplan wurde freigegeben.', review.conflicts.length ? 'warn' : 'good')
      window.dispatchEvent(new CustomEvent('habun:v2-tab', { detail: { name: 'schedule', model: app().model } }))
    } catch (error) { app().status(error.message, 'bad') }
  }, true)

  const observer = new MutationObserver(enhance)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('habun:v2-ready', enhance)
  window.addEventListener('habun:v2-tab', (event) => { if (event.detail.name === 'schedule') enhance() })
})()
