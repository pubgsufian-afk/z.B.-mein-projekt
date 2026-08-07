import assert from 'node:assert/strict'
import { parseGoogleMapsCoordinates, resolveGoogleMapsLocation } from '../netlify/functions/_shared/google-maps-location.mts'

assert.deepEqual(parseGoogleMapsCoordinates('https://www.google.com/maps/@52.123456,9.654321,17z'), { latitude: 52.123456, longitude: 9.654321 })
assert.deepEqual(parseGoogleMapsCoordinates('https://www.google.com/maps?q=52.123456,9.654321'), { latitude: 52.123456, longitude: 9.654321 })
assert.deepEqual(parseGoogleMapsCoordinates('https://www.google.com/maps/place/Test/data=!3d52.123456!4d9.654321'), { latitude: 52.123456, longitude: 9.654321 })
assert.deepEqual(parseGoogleMapsCoordinates('https://maps.google.com/?ll=52.123456,9.654321'), { latitude: 52.123456, longitude: 9.654321 })

await assert.rejects(() => resolveGoogleMapsLocation('https://not-google.invalid/maps/@52.1,9.6,17z'), /Google-Maps-Link/)

const calls = []
const finalUrl = 'https://www.google.com/maps/@52.987654,9.123456,18z'
const shortResult = await resolveGoogleMapsLocation('https://maps.app.goo.gl/abc123', async (url, options) => {
  calls.push(String(url))
  assert.equal(options?.redirect, 'manual')
  if (calls.length === 1) {
    return {
      status: 302,
      url: String(url),
      headers: { get: (name) => String(name).toLowerCase() === 'location' ? finalUrl : null },
    }
  }
  return { status: 200, url: String(url), headers: { get: () => null } }
})
assert.deepEqual(calls, ['https://maps.app.goo.gl/abc123', finalUrl])
assert.deepEqual(shortResult, { latitude: 52.987654, longitude: 9.123456, resolvedUrl: finalUrl })

await assert.rejects(() => resolveGoogleMapsLocation('https://maps.app.goo.gl/unsafe', async (url) => ({
  status: 302,
  url: String(url),
  headers: { get: () => 'https://not-google.invalid/maps/@52.1,9.6,17z' },
})), /Google-Maps-Link/)

await assert.rejects(() => resolveGoogleMapsLocation('https://www.google.com/maps/place/OhneKoordinaten'), /Koordinaten/)

console.log('Google Maps location tests passed')
