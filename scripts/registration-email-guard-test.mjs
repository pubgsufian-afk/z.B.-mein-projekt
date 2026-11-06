import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findRegistrationEmailConflict, normalizeRegistrationEmail } from '../netlify/functions/_shared/registration-email-guard.mts'

const original = { id: 'old-user-id', email: 'ahmed@example.de', status: 'approved', createdAt: '2026-10-01T11:00:00Z' }
const repeated = { id: 'new-user-id', email: '  AHMED@EXAMPLE.DE ', status: 'pending', createdAt: '2026-11-01T11:00:00Z' }

assert.equal(normalizeRegistrationEmail('  AHMED@EXAMPLE.DE '), 'ahmed@example.de')
assert.equal(normalizeRegistrationEmail('  AK@EXAMPLE.DE'), 'ak@example.de')
assert.deepEqual(findRegistrationEmailConflict(repeated, [original, repeated]), { id: 'old-user-id', status: 'approved' })
assert.equal(findRegistrationEmailConflict(original, [original, repeated]), null)
assert.deepEqual(findRegistrationEmailConflict(repeated, [{ ...original, status: 'pending' }, repeated]), { id: 'old-user-id', status: 'pending' })
assert.equal(findRegistrationEmailConflict({ ...original, status: 'pending' }, [{ ...original, status: 'pending' }, repeated]), null)
assert.equal(findRegistrationEmailConflict(repeated, [{ ...original, status: 'rejected' }, repeated]), null)
assert.equal(findRegistrationEmailConflict(repeated, [{ ...original, email: 'other@example.de' }, repeated]), null)
assert.equal(findRegistrationEmailConflict({ ...repeated, email: '' }, [original]), null)
assert.deepEqual(findRegistrationEmailConflict(repeated, [{ ...original, createdAt: repeated.createdAt, status: 'pending' }, repeated]), { id: 'old-user-id', status: 'pending' })
assert.equal(findRegistrationEmailConflict({ ...repeated, id: 'aaa' }, [{ ...original, id: 'zzz', status: 'pending', createdAt: repeated.createdAt }]), null)

const main = await readFile('netlify/functions/registrations.mts', 'utf8')
const relay = await readFile('netlify/functions/_shared/registration-admin-service.mts', 'utf8')
const validate = await readFile('netlify/functions/identity-validate.mts', 'utf8')
const ui = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(main, /payload\?\.action === 'approve'/)
assert.match(main, /findRegistrationEmailConflict\(target, registrations\)/)
assert.match(main, /REGISTRATION_CHECK_UNAVAILABLE/)
assert.match(relay, /findRegistrationEmailConflict\(\{ \.\.\.registration, id \}, registrations\)/)
assert.match(validate, /findRegistrationEmailConflict\(probe, existing\)/)
assert.match(validate, /statusCode: 409/)
assert.match(ui, /Bereits registriert\? Passwort vergessen/)
assert.match(ui, /setMode\('login'\)/)
console.log('Registration duplicate-email guard: 19 checks passed')
