export type ScheduleWorkArea = {
  key: string
  label: string
}

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/[._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const WORK_AREAS: Array<ScheduleWorkArea & { aliases: string[] }> = [
  { key: 'zuko', label: 'ZuKo', aliases: ['zuko', 'zu ko', 'zugangskontrolle'] },
  { key: 'gmp-rundgang', label: 'GMP Rundgang', aliases: ['gmp rundgang', 'gmp-rundgang', 'gmb rundgang', 'gmb-rundgang', 'gmp'] },
  { key: 'gmp-zuko', label: 'GMP ZuKo', aliases: ['gmp zuko', 'zuko gmp', 'gmb zuko', 'zuko gmb'] },
  { key: 'brandwache', label: 'Brandwache', aliases: ['brandwache', 'brandwach', 'brand wache'] },
  { key: 'lager-aufzug', label: 'Lager/Aufzug', aliases: ['lager', 'aufzug', 'lager aufzug', 'lager/aufzug'] },
  { key: 'baureinigung', label: 'Baureinigung', aliases: ['baureinigung', 'bau reinigung'] },
  { key: 'bauhelfer', label: 'Bauhelfer', aliases: ['bauhelfer', 'bau helfer'] },
  { key: 'lagerzelt', label: 'Lagerzelt', aliases: ['lagerzelt', 'lager zelt'] },
]

const BY_ALIAS = new Map<string, ScheduleWorkArea>()
for (const area of WORK_AREAS) {
  for (const alias of [area.label, ...area.aliases]) {
    BY_ALIAS.set(normalize(alias), { key: area.key, label: area.label })
  }
}

export function resolveScheduleWorkArea(input: unknown): ScheduleWorkArea | null {
  const normalized = normalize(input)
  if (!normalized) return null
  return BY_ALIAS.get(normalized) || null
}

function explicitPauseMinutes(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const pause = Number(value)
  return Number.isFinite(pause) && pause >= 0 ? Math.round(pause) : null
}

export function resolveSchedulePause(input: {
  workAreaKey: string
  start: string
  end: string
  explicitPause?: unknown
}) {
  const explicit = explicitPauseMinutes(input.explicitPause)
  if (explicit !== null) return explicit

  const key = String(input.workAreaKey || '').trim()
  const start = String(input.start || '').trim()
  const end = String(input.end || '').trim()

  if (key === 'brandwache' && start === '17:00' && end === '23:00') return 0
  if (['brandwache', 'gmp-rundgang', 'gmp-zuko'].includes(key) && start === '07:00' && end === '17:00') return 60
  if (['baureinigung', 'lager-aufzug'].includes(key) && start === '07:30' && end === '16:30') return 30
  if (key === 'bauhelfer' && start === '08:30' && end === '17:00') return 30

  // Unknown combinations preserve the historic safe default. Explicit user values always win above.
  return 0
}
