import assert from 'node:assert/strict'
import { provisionalRebindCandidates } from '../netlify/functions/_shared/schedule-provisional-reconciliation.mts'

const guest = (userId, fullName) => ({ userId, fullName })
const registered = (userId, fullName) => ({ userId, fullName, role: 'employee', status: 'active', location: '' })

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Test Person')],
    [registered('real-1', '  test   person  ')],
  ),
  [{ provisionalUserId: 'guest:a', userId: 'real-1', fullName: '  test   person  ' }],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Test Person')],
    [registered('real-1', 'Andere Person')],
  ),
  [],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Test Person')],
    [registered('real-1', 'Test Person'), registered('real-2', 'test person')],
  ),
  [],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Test Person'), guest('guest:b', ' test person ')],
    [registered('real-1', 'Test Person')],
  ),
  [],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Test Person Eins')],
    [registered('real-1', 'Test Person Zwei')],
  ),
  [],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('real-old', 'Test Person')],
    [registered('real-1', 'Test Person')],
  ),
  [],
)

assert.deepEqual(
  provisionalRebindCandidates(
    [guest('guest:a', 'Jörg Beispiel')],
    [registered('real-1', 'jorg beispiel')],
  ),
  [{ provisionalUserId: 'guest:a', userId: 'real-1', fullName: 'jorg beispiel' }],
)

console.log('Schedule provisional reconciliation tests passed')
