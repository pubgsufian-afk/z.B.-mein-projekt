export async function runEmployeeHistoryCorrectionFlow(invoke, input) {
  if (typeof invoke !== 'function') throw new TypeError('Relay-Aufruf fehlt.')
  const baseInput = {
    employeeUserId: String(input.targetUserId || '').trim(),
    employeeName: String(input.targetFullName || '').trim(),
    from: String(input.from || '').trim(),
    to: String(input.to || '').trim(),
    domains: Array.isArray(input.domains) ? input.domains : ['schedule', 'attendance'],
  }
  const before = await invoke({
    domain: 'portal',
    action: 'inspect-employee-history',
    input: baseInput,
  })
  const rebound = await invoke({
    domain: 'portal',
    action: 'rebind-employee-history',
    input: {
      sourceUserId: String(input.sourceUserId || '').trim(),
      targetUserId: baseInput.employeeUserId,
      targetFullName: baseInput.employeeName,
      from: baseInput.from,
      to: baseInput.to,
      domains: baseInput.domains,
      reason: String(input.reason || '').trim(),
    },
  })
  const after = await invoke({
    domain: 'portal',
    action: 'inspect-employee-history',
    input: baseInput,
  })
  return { before, rebound, after }
}
