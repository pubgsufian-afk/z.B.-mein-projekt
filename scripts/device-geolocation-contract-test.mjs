import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('frontend/src/App.jsx', 'utf8')

assert.ok(
  source.includes('function requestCurrentDeviceLocation()'),
  'A reusable device-independent geolocation helper must exist.',
)
assert.ok(
  source.includes('navigator.geolocation.getCurrentPosition'),
  'The portal must use the standard browser Geolocation API.',
)
assert.ok(
  source.includes("if (action === 'clock-in') {") && source.includes('location = await requestCurrentDeviceLocation()'),
  'Clock-in must require the current device location from the button action.',
)
assert.ok(
  source.includes("else if (action === 'clock-out') {") && source.includes('try { location = await requestCurrentDeviceLocation() } catch { location = null }'),
  'Clock-out may capture the current location but must continue when location is unavailable.',
)
assert.ok(
  source.includes('const location = await requestCurrentDeviceLocation()'),
  'Admin worksite location capture must use the same device-independent geolocation helper.',
)
assert.ok(!/navigator\.userAgent|iPhone|iPad|Samsung/i.test(source.match(/function requestCurrentDeviceLocation\(\)[\s\S]*?\n}\n/)?.[0] || ''), 'Geolocation must not be restricted by device brand or user agent.')
assert.ok(source.includes('enableHighAccuracy: true'), 'High accuracy must be requested when available.')
assert.ok(source.includes('maximumAge: 0'), 'Clock-in and optional clock-out location capture must request a fresh position instead of a cached position.')

console.log('Device-independent geolocation contract passed')
