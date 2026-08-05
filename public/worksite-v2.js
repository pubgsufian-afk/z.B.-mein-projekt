document.addEventListener('submit', async (event) => {
  const form = event.target.closest?.('[data-object-form]')
  if (!form) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const payload = Object.fromEntries(new FormData(form).entries())
  try {
    const result = await window.HabunAttendanceV2.jsonFetch('/api/worksite-v2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    window.HabunAttendanceV2.status(result.databaseSynced
      ? 'Einsatzort und Standortprüfung wurden gespeichert.'
      : 'Einsatzort wurde gespeichert. Die Datenbankverbindung muss vor der Veröffentlichung noch eingerichtet werden.', result.databaseSynced ? 'good' : 'warn')
    form.reset()
    window.dispatchEvent(new CustomEvent('habun:v2-tab', { detail: { name: 'schedule', model: window.HabunAttendanceV2.model } }))
  } catch (error) {
    window.HabunAttendanceV2.status(error.message || 'Einsatzort konnte nicht gespeichert werden.', 'bad')
  }
}, true)
