(() => {
  'use strict'

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

  function isEmployeeIdText(value) {
    return LABEL_PATTERN.test(normalized(value))
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

  function removeLabelledRows() {
    document.querySelectorAll('label, dt, th, td, p, span, strong').forEach((node) => {
      if (!isEmployeeIdText(node.textContent)) return

      if (node.tagName === 'TH') {
        const table = node.closest('table')
        const row = node.parentElement
        const index = row ? [...row.children].indexOf(node) : -1
        if (table && index >= 0) {
          table.querySelectorAll('tr').forEach((tableRow) => tableRow.children[index]?.remove())
        }
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

  function apply() {
    document.querySelectorAll(INPUT_SELECTOR).forEach((input) => {
      if (input instanceof HTMLInputElement) hideField(input)
    })
    removeLabelledRows()
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
  observer.observe(document.documentElement, { childList: true, subtree: true })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule)
  else schedule()
})()
