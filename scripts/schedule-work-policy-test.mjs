import assert from 'node:assert/strict'
import {
  resolveSchedulePause,
  resolveScheduleWorkArea,
} from '../netlify/functions/_shared/schedule-work-policy.mts'

assert.deepEqual(resolveScheduleWorkArea('Brandwach'), { key: 'brandwache', label: 'Brandwache' })
assert.deepEqual(resolveScheduleWorkArea('brandwache'), { key: 'brandwache', label: 'Brandwache' })
assert.deepEqual(resolveScheduleWorkArea('GMP Rundgang'), { key: 'gmp-rundgang', label: 'GMP Rundgang' })
assert.deepEqual(resolveScheduleWorkArea('GMB Rundgang'), { key: 'gmp-rundgang', label: 'GMP Rundgang' })
assert.deepEqual(resolveScheduleWorkArea('GMP ZuKo'), { key: 'gmp-zuko', label: 'GMP ZuKo' })
assert.deepEqual(resolveScheduleWorkArea('ZuKo GMP'), { key: 'gmp-zuko', label: 'GMP ZuKo' })
assert.deepEqual(resolveScheduleWorkArea('Lager/Aufzug'), { key: 'lager-aufzug', label: 'Lager/Aufzug' })
assert.deepEqual(resolveScheduleWorkArea('Baureinigung'), { key: 'baureinigung', label: 'Baureinigung' })
assert.deepEqual(resolveScheduleWorkArea('Bauhelfer'), { key: 'bauhelfer', label: 'Bauhelfer' })
assert.equal(resolveScheduleWorkArea('Unbekannter Bereich'), null)

assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '07:00', end: '17:00' }), 60)
assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '17:00', end: '23:00' }), 0)
assert.equal(resolveSchedulePause({ workAreaKey: 'gmp-rundgang', start: '07:00', end: '17:00' }), 60)
assert.equal(resolveSchedulePause({ workAreaKey: 'gmp-zuko', start: '07:00', end: '17:00' }), 60)
assert.equal(resolveSchedulePause({ workAreaKey: 'baureinigung', start: '07:30', end: '16:30' }), 30)
assert.equal(resolveSchedulePause({ workAreaKey: 'lager-aufzug', start: '07:30', end: '16:30' }), 30)
assert.equal(resolveSchedulePause({ workAreaKey: 'bauhelfer', start: '08:30', end: '17:00' }), 30)
assert.equal(resolveSchedulePause({ workAreaKey: 'zuko', start: '06:00', end: '17:00' }), 0)
assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '07:00', end: '17:00', explicitPause: 0 }), 0)
assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '07:00', end: '17:00', explicitPause: 30 }), 30)
assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '07:00', end: '17:00', explicitPause: -1 }), null)
assert.equal(resolveSchedulePause({ workAreaKey: 'brandwache', start: '07:00', end: '17:00', explicitPause: 'x' }), null)

console.log('Schedule work policy tests passed')
