function installCorrectionTab() {
  const app = window.HabunAttendanceV2
  const tabs = app?.model?.panel?.querySelector('.habun-v2-tabs')
  if (!tabs || tabs.querySelector('[data-tab="corrections"]')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.tab = 'corrections'
  button.setAttribute('aria-selected', 'false')
  button.textContent = 'Korrekturen'
  button.addEventListener('click', () => app.activateTab('corrections'))
  tabs.append(button)
}
window.addEventListener('habun:v2-ready', installCorrectionTab)
if (window.HabunAttendanceV2) installCorrectionTab()
