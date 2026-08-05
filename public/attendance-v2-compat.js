(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
  function upgradeLegacyAttendance() {
    document.querySelectorAll('.employee-panel').forEach((panel) => {
      if (!/Heutiger Dienst|Arbeitszeit/i.test(normalize(panel.textContent))) return
      const buttons = [...panel.querySelectorAll('button')]
      const legacy = buttons.filter((button) => /Arbeitsbeginn|Arbeitsende eintragen|Pause starten|Pause beenden/i.test(normalize(button.textContent)))
      legacy.forEach((button) => {
        button.hidden = true
        button.setAttribute('aria-hidden', 'true')
        button.tabIndex = -1
      })
      if (legacy.length && !panel.querySelector('[data-v2-legacy-note]')) {
        const note = document.createElement('div')
        note.dataset.v2LegacyNote = 'true'
        note.className = 'habun-v2-status'
        note.innerHTML = '<strong>Neue Zeiterfassung aktiv</strong><br>Arbeitsbeginn und Arbeitsende werden über die neue Stempeluhr erfasst. Pausen werden automatisch aus dem Dienstplan übernommen.'
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'habun-v2-primary'
        open.textContent = 'Neue Stempeluhr öffnen'
        open.addEventListener('click', () => window.HabunAttendanceV2?.open())
        note.append(document.createElement('br'), open)
        panel.append(note)
      }
    })
    document.querySelectorAll('.enhanced-settings-note').forEach((node) => {
      if (/ausschließlich beim Arbeitsbeginn/i.test(node.textContent || '')) {
        node.innerHTML = '<strong>Standort und Aufbewahrung</strong>Der Standort wird ausschließlich beim Arbeitsbeginn und Arbeitsende einmalig aufgenommen. Es findet keine dauerhafte Ortung statt.'
      }
    })
  }
  const observer = new MutationObserver(upgradeLegacyAttendance)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', upgradeLegacyAttendance)
  else upgradeLegacyAttendance()
})()
