// Gemeinsame, testbare Darstellung von protokollierten Änderungen.
// Die gespeicherten Originaldaten bleiben unverändert und überprüfbar.
const LABELS = {
  role: 'Berechtigung',
  status: 'Status',
  fullName: 'Name',
  employeeName: 'Mitarbeiter',
  company: 'Firma',
  companyName: 'Firmenname',
  email: 'E-Mail',
  phone: 'Telefonnummer',
  address: 'Adresse',
  location: 'Einsatzort',
  name: 'Bezeichnung',
  date: 'Datum',
  workDate: 'Arbeitstag',
  week: 'Kalenderwoche',
  dates: 'Betroffene Tage',
  published: 'Veröffentlichte Dienste',
  employeeUserId: 'Mitarbeiter-Konto',
  start: 'Dienstbeginn',
  end: 'Dienstende',
  clockInAt: 'Arbeitsbeginn',
  clockOutAt: 'Arbeitsende',
  startTime: 'Beginn',
  endTime: 'Ende',
  pauseMinutes: 'Pause',
  netMinutes: 'Nettoarbeitszeit',
  workArea: 'Arbeitsbereich',
  note: 'Hinweis',
  reason: 'Begründung',
  sourceWeek: 'Ursprungswoche',
  targetWeek: 'Zielwoche',
  count: 'Anzahl',
  words: 'Wortanzahl',
  title: 'Dokumenttitel',
  documentType: 'Dokumentart',
  radiusMeters: 'Prüfradius',
  latitude: 'Breitengrad',
  longitude: 'Längengrad',
  accuracyMeters: 'Genauigkeit',
  createdAt: 'Erstellt am',
  updatedAt: 'Geändert am',
}

const ROLES = { owner: 'Inhaber', admin: 'Administrator', manager: 'Einsatzleiter', scheduler: 'Dienstplaner', employee: 'Mitarbeiter', pending: 'Nicht freigegeben' }
const STATES = { active: 'Aktiv', inactive: 'Deaktiviert', approved: 'Freigegeben', rejected: 'Abgelehnt', published: 'Veröffentlicht', draft: 'Entwurf', pending: 'In Prüfung' }
const TECHNICAL = /^(id|userId|actorId|actorEmail|actorRole|employeeUserId|objectId|scheduleId|shiftId|documentId|entryId|repeatGroupId|templateId|sourceRef|source|version|createdBy|updatedBy|publishedBy|publishedAt|updatedAt|createdAt|grantedAt|grantedBy|blobKey|sha256)$/i

const TEXT_ACTIONS = {
  'shift-created': 'hat einen Dienst angelegt',
  'shift-updated': 'hat einen Dienst geändert',
  'shift-published': 'hat einen Dienst veröffentlicht',
  'shift-week-published': 'hat einen Dienst im Wochenplan veröffentlicht',
  'shift-copied': 'hat einen Dienst aus der Vorwoche übernommen',
  'shift-repeated': 'hat einen Dienst auf weitere Tage übertragen',
  'day-off-set': 'hat einen dienstfreien Tag eingetragen',
  'shift-overlap-admin-approved': 'hat eine Dienstüberschneidung ausdrücklich genehmigt',
  'shift-deleted': 'hat einen Dienst gelöscht',
  'week-published': 'hat einen Wochenplan veröffentlicht',
  'Dienst gelöscht': 'hat einen Dienst gelöscht',
  'Dienst bearbeitet': 'hat einen Dienst geändert',
  'Dienst erstellt': 'hat einen Dienst angelegt',
  'Dienst wiederholt': 'hat einen Dienst wiederholt',
  'Vorwoche kopiert': 'hat eine Dienstplanwoche kopiert',
  'Berechtigung geändert': 'hat eine Mitarbeiterberechtigung geändert',
  'Mitarbeiterprofil geändert': 'hat ein Mitarbeiterprofil geändert',
  'Konto deaktiviert': 'hat ein Mitarbeiterkonto deaktiviert',
  'Tagesbericht erstellt': 'hat einen Tagesbericht erstellt',
  'Tagesbericht bearbeitet': 'hat einen Tagesbericht bearbeitet',
  'Tagesbericht gelöscht': 'hat einen Tagesbericht gelöscht',
  'Einsatzort geändert': 'hat einen Einsatzort geändert',
  'Einsatzort erstellt': 'hat einen Einsatzort angelegt',
  'Einsatzort gelöscht': 'hat einen Einsatzort gelöscht',
  'Firmendaten geändert': 'hat Firmendaten geändert',
  'PDF-Logo geändert': 'hat das PDF-Logo geändert',
  'PDF-Logo zurückgesetzt': 'hat das PDF-Logo zurückgesetzt',
  upload: 'hat ein Dokument hochgeladen',
  revoke: 'hat ein Dokument zurückgezogen',
  'manual-create': 'hat einen Stundenzettel-Eintrag erstellt',
  'manual-update': 'hat einen Stundenzettel-Eintrag geändert',
  'manual-delete': 'hat einen Stundenzettel-Eintrag gelöscht',
  'admin-time-edit': 'hat Arbeitszeiten korrigiert',
}

export function auditFieldLabel(key) {
  return LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

export function auditValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Nicht angegeben'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein'
  if (Array.isArray(value)) return value.map((entry) => auditValue(key, entry)).join(', ')
  if (typeof value === 'object') return Object.entries(value).map(([field, entry]) => auditFieldLabel(field) + ': ' + auditValue(field, entry)).join(' · ')
  const raw = String(value)
  if (key === 'role') return ROLES[raw] || raw
  if (key === 'status') return STATES[raw] || raw
  if (key === 'documentType') return ({ contract: 'Arbeitsvertrag', payslip: 'Lohnabrechnung', other: 'Sonstiges Dokument' })[raw] || raw
  if (/^(pauseMinutes|netMinutes)$/.test(key) && Number.isFinite(Number(value))) return raw + ' Minuten'
  if (/^(radiusMeters|accuracyMeters)$/.test(key) && Number.isFinite(Number(value))) return raw + ' m'
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.split('-').reverse().join('.')
  return raw
}

export function auditChanges(event) {
  const before = event?.before && typeof event.before === 'object' ? event.before : {}
  const after = event?.after && typeof event.after === 'object' ? event.after : {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys
    .filter((key) => !TECHNICAL.test(key) && !/password|token|secret|authorization|cookie/i.test(key))
    .map((key) => {
      const old = before[key]
      const next = after[key]
      if (old === undefined && next === undefined) return null
      if (old !== undefined && next !== undefined && JSON.stringify(old) === JSON.stringify(next)) return null
      return {
        key,
        label: auditFieldLabel(key),
        before: old === undefined ? null : auditValue(key, old),
        after: next === undefined ? null : auditValue(key, next),
        hasBefore: old !== undefined,
        hasAfter: next !== undefined,
      }
    }).filter(Boolean)
}

export function describeAuditEvent(event) {
  const actor = String(event?.actorName || event?.actorEmail || 'Ein Administrator').trim()
  const target = String(event?.targetName || '').trim()
  const action = String(event?.action || '').trim()
  const category = String(event?.category || '').trim()
  let verb = TEXT_ACTIONS[action] || ''
  if (!verb && /permission|role/i.test(action)) verb = 'hat eine Berechtigung geändert'
  if (!verb && /correction|adjust|time-edit|session-update/i.test(action)) verb = 'hat Arbeitszeiten korrigiert'
  if (!verb && /publish/i.test(action)) verb = 'hat eine Änderung veröffentlicht'
  if (!verb && /delete|remove/i.test(action)) verb = 'hat einen Eintrag gelöscht'
  if (!verb && /create|add/i.test(action)) verb = 'hat einen Eintrag erstellt'
  if (!verb && /update|edit|save/i.test(action)) verb = 'hat einen Eintrag geändert'
  if (!verb) verb = 'hat eine Änderung vorgenommen'

  // The target's current name may be unavailable for a deleted/legacy account.
  // Explicitly say so instead of claiming an unrelated person was changed.
  const affectedEmployee = category === 'Mitarbeiter'
  const employeePhrase = target ? ' von ' + target : ' eines Mitarbeiters'
  if (category === 'Mitarbeiter') {
    if (/Berechtigung|role|permission/i.test(action)) verb = 'hat die Berechtigung' + employeePhrase + ' geändert'
    else if (/profil/i.test(action)) verb = 'hat das Profil' + employeePhrase + ' geändert'
    else if (/deaktiv/i.test(action)) verb = 'hat das Konto' + employeePhrase + ' deaktiviert'
    else if (/approve|freig/i.test(action)) verb = 'hat das Konto' + employeePhrase + ' freigegeben'
    else if (target) verb += ' für ' + target
  } else if (target && ['Dienstplan', 'Arbeitszeiten', 'Stundenzettel', 'Dokumente', 'Berichte'].includes(category)) {
    verb += ' für ' + target
  }

  const changes = auditChanges(event)
  return { title: actor + ' ' + verb + '.', changes }
}
