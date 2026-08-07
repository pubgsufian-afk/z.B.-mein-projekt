const SHORT_GOOGLE_MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl'])

function isAllowedGoogleMapsHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'google.com'
    || host.endsWith('.google.com')
    || host === 'google.de'
    || host.endsWith('.google.de')
    || SHORT_GOOGLE_MAP_HOSTS.has(host)
}

function parseUrl(rawUrl: string) {
  let url: URL
  try { url = new URL(String(rawUrl || '').trim()) }
  catch { throw new TypeError('Bitte einen gültigen Google-Maps-Link einfügen.') }
  if (url.protocol !== 'https:') throw new TypeError('Bitte einen sicheren Google-Maps-Link mit https:// verwenden.')
  if (!isAllowedGoogleMapsHost(url.hostname)) throw new TypeError('Es sind nur Google-Maps-Links erlaubt.')
  return url
}

function coordinatePair(latitudeValue: unknown, longitudeValue: unknown) {
  const latitude = Number(latitudeValue)
  const longitude = Number(longitudeValue)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function pairFromText(value: string | null) {
  const match = String(value || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  return match ? coordinatePair(match[1], match[2]) : null
}

export function parseGoogleMapsCoordinates(rawUrl: string) {
  const url = parseUrl(rawUrl)
  const decoded = decodeURIComponent(url.href)

  const atMatch = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/)
  if (atMatch) {
    const pair = coordinatePair(atMatch[1], atMatch[2])
    if (pair) return pair
  }

  for (const key of ['q', 'query', 'll']) {
    const pair = pairFromText(url.searchParams.get(key))
    if (pair) return pair
  }

  const dataMatch = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (dataMatch) {
    const pair = coordinatePair(dataMatch[1], dataMatch[2])
    if (pair) return pair
  }

  return null
}

export async function resolveGoogleMapsLocation(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const initialUrl = parseUrl(rawUrl)
  const direct = parseGoogleMapsCoordinates(initialUrl.href)
  if (direct) return { ...direct, resolvedUrl: initialUrl.href }

  if (!SHORT_GOOGLE_MAP_HOSTS.has(initialUrl.hostname.toLowerCase())) {
    throw new TypeError('In diesem Google-Maps-Link konnten keine Koordinaten erkannt werden. Bitte in Google Maps einen Pin setzen und den Link erneut kopieren.')
  }

  let response: { url?: string; ok?: boolean }
  try {
    response = await fetchImpl(initialUrl.href, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Habun-Security-Worksite-Resolver/1.0' },
    }) as unknown as { url?: string; ok?: boolean }
  } catch {
    throw new TypeError('Der Google-Maps-Kurzlink konnte nicht aufgelöst werden. Bitte erneut versuchen oder einen direkten Google-Maps-Link verwenden.')
  }

  const resolvedUrl = parseUrl(String(response?.url || ''))
  const coordinates = parseGoogleMapsCoordinates(resolvedUrl.href)
  if (!coordinates) throw new TypeError('Im aufgelösten Google-Maps-Link konnten keine Koordinaten erkannt werden.')
  return { ...coordinates, resolvedUrl: resolvedUrl.href }
}
