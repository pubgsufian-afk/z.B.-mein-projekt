(() => {
  const STYLE_ID = 'habun-report-filter-style'

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .habun-report-native-select { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
      .habun-report-filter { display:grid; gap:.55rem; margin-top:.45rem; }
      .habun-report-filter-summary { min-height:3.35rem; display:flex; align-items:center; padding:.8rem 1rem; border:1px solid var(--line,#2a3238); border-radius:1rem; background:rgba(255,255,255,.025); color:inherit; font:inherit; font-weight:800; }
      .habun-report-filter-options { display:grid; gap:.45rem; max-height:11rem; padding:.55rem; overflow:auto; border:1px solid var(--line,#2a3238); border-radius:1rem; background:rgba(0,0,0,.16); }
      .habun-report-filter-option { width:100%; min-height:2.75rem; display:flex; align-items:center; gap:.7rem; padding:.55rem .7rem; border:0; border-radius:.75rem; background:rgba(255,255,255,.025); color:inherit; font:inherit; text-align:left; }
      .habun-report-filter-option::before { content:''; width:1.15rem; height:1.15rem; flex:0 0 1.15rem; border:2px solid #d8ad38; border-radius:.28rem; box-sizing:border-box; }
      .habun-report-filter-option[aria-checked='true']::before { background:#d8ad38; box-shadow:inset 0 0 0 3px #111; }
      .habun-report-filter-empty { padding:.65rem; color:#9ba3a8; }
      @media (max-width:720px) { .habun-report-filter-options { max-height:9rem; } }
    `
    document.head.append(style)
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || !select.multiple) return
    const owner = select.closest('.reports-filter label')
    if (!owner) return
    installStyle()
    select.classList.add('habun-report-native-select')

    let widget = owner.querySelector(':scope > .habun-report-filter')
    if (!widget) {
      widget = document.createElement('div')
      widget.className = 'habun-report-filter'
      widget.addEventListener('click', (event) => event.stopPropagation())
      select.insertAdjacentElement('afterend', widget)
    }

    const signature = [...select.options].map((option) => `${option.value}:${option.text}`).join('|')
    if (widget.dataset.signature !== signature) {
      widget.dataset.signature = signature
      widget.replaceChildren()
      const summary = document.createElement('div')
      summary.className = 'habun-report-filter-summary'
      summary.setAttribute('aria-live', 'polite')
      const options = document.createElement('div')
      options.className = 'habun-report-filter-options'
      widget.append(summary, options)

      if (!select.options.length) {
        const empty = document.createElement('span')
        empty.className = 'habun-report-filter-empty'
        empty.textContent = 'Keine Mitarbeiter verfügbar.'
        options.append(empty)
      } else {
        for (const option of select.options) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'habun-report-filter-option'
          button.dataset.value = option.value
          button.setAttribute('role', 'checkbox')
          button.textContent = option.text
          button.addEventListener('click', () => {
            option.selected = !option.selected
            select.dispatchEvent(new Event('change', { bubbles: true }))
            sync(select, widget)
          })
          options.append(button)
        }
      }
    }
    sync(select, widget)
  }

  function sync(select, widget) {
    const selected = [...select.selectedOptions]
    const summary = widget.querySelector('.habun-report-filter-summary')
    const summaryText = selected.length ? `${selected.length} Mitarbeiter ausgewählt` : 'Alle Mitarbeiter'
    if (summary && summary.textContent !== summaryText) summary.textContent = summaryText
    for (const button of widget.querySelectorAll('.habun-report-filter-option')) {
      const option = [...select.options].find((item) => item.value === button.dataset.value)
      const checked = option?.selected ? 'true' : 'false'
      if (button.getAttribute('aria-checked') !== checked) button.setAttribute('aria-checked', checked)
    }
  }

  function relabelReports() {
    const filter = document.querySelector('.reports-filter')
    const panel = filter?.closest('.panel')
    if (panel) {
      const heading = panel.querySelector('.page-heading h2')
      const subtitle = panel.querySelector('.page-heading p')
      if (heading && heading.textContent !== 'Stundenzettel') heading.textContent = 'Stundenzettel'
      if (subtitle && subtitle.textContent !== 'Tatsächlich gebuchte Arbeitszeiten. Der Dienstplan bleibt ein separates Dokument.') {
        subtitle.textContent = 'Tatsächlich gebuchte Arbeitszeiten. Der Dienstplan bleibt ein separates Dokument.'
      }
      const buttons = [...panel.querySelectorAll('.form-actions button')]
      if (buttons[0] && !buttons[0].disabled) buttons[0].textContent = 'Stundenzettel Vorschau'
      if (buttons[1] && !buttons[1].disabled) buttons[1].textContent = 'Stundenzettel PDF'
      if (buttons[2] && !buttons[2].disabled) buttons[2].textContent = 'Stundenzettel Excel'
    }

    for (const heading of document.querySelectorAll('.page-heading h2')) {
      if (heading.textContent === 'PDF-Vorschau') heading.textContent = 'Stundenzettel Vorschau'
    }
  }

  function scan() {
    document.querySelectorAll('.reports-filter select[multiple]').forEach(enhance)
    relabelReports()
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('change', (event) => {
    const select = event.target
    if (select instanceof HTMLSelectElement && select.matches('.reports-filter select[multiple]')) enhance(select)
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true })
  else scan()
})()
