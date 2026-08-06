(() => {
  'use strict'

  const PHRASE_PATTERN = /Mitarbeiter[-\s]?ID|Personalnummer/gi
  const LABEL_PATTERN = /^(Mitarbeiter[-\s]?ID|Personalnummer)\s*:?(?:\s.*)?$/i
  const INPUT_SELECTOR = [
    'input[name="employeeId"]',
    'input[name="employee_id"]',
    'input[id="employeeId"]',
    'input[id="employee_id"]',
  ].join(',')
  const COMPATIBILITY_VALUE = 'nicht-verwendet'

  function normalized(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function hideField(input) {
    input.required = false
    input.removeAttribute('aria-required')
    if (!normalized(input.value)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, COMPATIBILITY_VALUE)
      else input.value = COMPATIBILITY_VALUE
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const wrapper = input.closest('label, .form-group, .field, .input-group') || input.parentElement
    if (wrapper instanceof HTMLElement) {
      wrapper.hidden = true
      wrapper.setAttribute('aria-hidden', 'true')
      wrapper.dataset.employeeIdRemoved = 'true'
    } else {
      input.hidden = true
      input.setAttribute('aria-hidden', 'true')
    }
  }

  function removeStructuredLabels() {
    document.querySelectorAll('label, dt, th, td, p, span, strong, div').forEach((node) => {
      const ownText = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent || '')
        .join(' ')
      if (!LABEL_PATTERN.test(normalized(ownText))) return

      if (node.tagName === 'TH') {
        const table = node.closest('table')
        const row = node.parentElement
        const index = row ? [...row.children].indexOf(node) : -1
        if (table && index >= 0) table.querySelectorAll('tr').forEach((tableRow) => tableRow.children[index]?.remove())
        return
      }
      if (node.tagName === 'DT') {
        const next = node.nextElementSibling
        node.remove()
        if (next?.tagName === 'DD') next.remove()
        return
      }
      const input = node.querySelector?.(INPUT_SELECTOR)
      if (input instanceof HTMLInputElement) {
        hideField(input)
        return
      }
      const row = node.closest('tr, .data-row, .detail-row, .profile-row, .info-row')
      if (row) row.remove()
      else node.remove()
    })
  }

  function scrubRemainingText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      if (!PHRASE_PATTERN.test(node.textContent || '')) continue
      PHRASE_PATTERN.lastIndex = 0
      node.textContent = String(node.textContent || '').replace(PHRASE_PATTERN, '').replace(/\s*:\s*/, ' ').trim()
    }
    PHRASE_PATTERN.lastIndex = 0
  }

  function apply() {
    document.querySelectorAll(INPUT_SELECTOR).forEach((input) => {
      if (input instanceof HTMLInputElement) hideField(input)
    })
    removeStructuredLabels()
    scrubRemainingText()
  }

  let queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      apply()
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule)
  else schedule()
})()
