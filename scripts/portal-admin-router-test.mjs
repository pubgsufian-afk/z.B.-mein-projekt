import assert from 'node:assert/strict'
import { createPortalAdminRouter } from '../netlify/functions/_shared/portal-admin-router.mts'

const calls = []
const router = createPortalAdminRouter({
  schedule: async (operation, context) => {
    calls.push([operation.itemId, context.commandId])
    return {
      itemId: operation.itemId,
      domain: operation.domain,
      action: operation.action,
      status: operation.action === 'find-duplicates' ? 'duplicate' : 'success',
      data: { shiftId: operation.input.shiftId },
    }
  },
  attendance: async (operation) => {
    if (operation.input.explode === true) throw new Error('private detail')
    return { itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'success' }
  },
})

const responseKey = Buffer.alloc(32, 1).toString('base64')
const result = await router.run({
  version: 1,
  commandId: 'batch-1',
  createdAt: new Date().toISOString(),
  domain: 'portal',
  action: 'portal-batch',
  reason: 'test reason',
  responseKey,
  operations: [
    { itemId: 'a', domain: 'schedule', action: 'update-shift', input: { shiftId: 's1' } },
    { itemId: 'b', domain: 'employees', action: 'get', input: { userId: 'u1' } },
    { itemId: 'c', domain: 'attendance', action: 'update-session', input: { explode: true } },
    { itemId: 'd', domain: 'schedule', action: 'find-duplicates', input: { shiftId: 's2' } },
    { itemId: 'e', domain: 'schedule', action: 'unknown-action', input: {} },
  ],
})
assert.deepEqual(result.results.map((row) => row.itemId), ['a', 'b', 'c', 'd', 'e'])
assert.equal(result.results[0].status, 'success')
assert.equal(result.results[1].status, 'rejected')
assert.equal(result.results[1].code, 'DOMAIN_NOT_REGISTERED')
assert.equal(result.results[2].status, 'rejected')
assert.equal(result.results[2].code, 'HANDLER_FAILED')
assert.equal(result.results[3].status, 'duplicate')
assert.equal(result.results[4].status, 'rejected')
assert.equal(result.results[4].code, 'ACTION_NOT_REGISTERED')
assert.equal(result.counts.processed, 5)
assert.equal(result.counts.succeeded, 2)
assert.equal(result.counts.rejected, 3)
assert.deepEqual(calls, [['a', 'batch-1'], ['d', 'batch-1']])
assert.equal('input' in result.results[1], false)

const single = await router.run({
  version: 1,
  commandId: 'single-1',
  createdAt: new Date().toISOString(),
  domain: 'schedule',
  action: 'update-shift',
  input: { shiftId: 's3' },
  responseKey,
})
assert.equal(single.results.length, 1)
assert.equal(single.results[0].itemId, 'single-1')
assert.equal(single.counts.succeeded, 1)

console.log('portal admin router tests passed')
