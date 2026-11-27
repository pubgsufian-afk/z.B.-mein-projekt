export const WARNING_REASONS = {
  late: ['Verspäteter Dienstantritt', 'Erscheinen Sie künftig pünktlich und arbeitsbereit zum vereinbarten Dienstbeginn.'],
  absence: ['Unentschuldigtes Fehlen / Nichterscheinen', 'Treten Sie die vereinbarten Dienste an und melden Sie eine Verhinderung unverzüglich nach den geltenden Vorgaben.'],
  departure: ['Unerlaubtes Verlassen des Arbeitsplatzes', 'Verlassen Sie den Einsatzort während des Dienstes nur nach den geltenden Anweisungen.'],
  sleep: ['Schlafen im Dienst', 'Halten Sie sich während des Dienstes einsatzbereit und erfüllen Sie die vereinbarten Aufgaben.'],
  instructions: ['Missachtung einer Dienstanweisung', 'Beachten Sie die rechtmäßigen und Ihnen bekannt gegebenen Dienstanweisungen.'],
  patrol: ['Kontrollgang / Rundgang nicht durchgeführt', 'Führen Sie die vorgeschriebenen Kontrollgänge ordnungsgemäß durch und dokumentieren Sie sie.'],
  access: ['Verstoß gegen Zutrittskontrolle / Schlüsselregelung', 'Beachten Sie die vorgeschriebenen Zutritts-, Schlüssel- und Übergaberegelungen.'],
  firewatch: ['Verstoß gegen Brandwache / Sicherheitsvorgaben', 'Beachten Sie die für Ihren Einsatz geltenden Sicherheits- und Brandwachanweisungen.'],
  gmp: ['Verstoß gegen Hygiene-, GMP- oder Arbeitsschutzvorgaben', 'Beachten Sie die geltenden und Ihnen bekannt gegebenen Hygiene- und Arbeitsschutzanweisungen.'],
  cleaning: ['Reinigungsauftrag nicht ordnungsgemäß ausgeführt', 'Führen Sie die vereinbarten Reinigungsarbeiten gemäß den konkreten Arbeitsanweisungen aus.'],
  attendance: ['Fehlende oder fehlerhafte Zeiterfassung', 'Erfassen Sie Ihre tatsächlichen Arbeitszeiten vollständig und korrekt; melden Sie technische Probleme unverzüglich.'],
  falsification: ['Unrichtige Angaben / Manipulation der Zeiterfassung', 'Machen Sie vollständige und wahrheitsgemäße Angaben zu Ihren Arbeitszeiten und Tätigkeiten.'],
  clothes: ['Dienstkleidung / Schutzausrüstung nicht getragen', 'Tragen Sie die für Ihren Einsatz vorgeschriebene Kleidung und Schutzausrüstung.'],
  phone: ['Unzulässige private Handynutzung im Dienst', 'Beachten Sie die für Ihren Einsatz geltenden Regeln zur privaten Handynutzung.'],
  conduct: ['Unangemessenes Verhalten gegenüber Kunden oder Kollegen', 'Verhalten Sie sich respektvoll und professionell gegenüber Kunden, Kollegen und Vorgesetzten.'],
  refusal: ['Verweigerung einer rechtmäßigen Arbeitsanweisung', 'Erfüllen Sie Ihre arbeitsvertraglichen Pflichten und befolgen Sie rechtmäßige Arbeitsanweisungen.'],
  reporting: ['Unterlassene Meldung eines Vorfalls / Dienstübergabe', 'Melden Sie relevante Vorfälle und führen Sie die vorgeschriebenen Übergaben ordnungsgemäß durch.'],
  confidentiality: ['Verstoß gegen Verschwiegenheit / Datenschutz', 'Beachten Sie die geltenden Verschwiegenheits- und Datenschutzpflichten.'],
  other: ['Sonstiger konkreter Pflichtverstoß', 'Unterlassen Sie den beschriebenen Pflichtverstoß künftig und erfüllen Sie Ihre arbeitsvertraglichen Pflichten.'],
}
export const TERMINATION_TYPES = {
  ordinary: 'Ordentliche Kündigung',
  probation: 'Ordentliche Kündigung während der Probezeit',
  extraordinary: 'Außerordentliche fristlose Kündigung',
}
export const ACK_TEXT = 'Ich bestätige ausschließlich den Erhalt dieses Dokuments im Portal. Die Bestätigung bedeutet keine Zustimmung zum Inhalt und keinen Verzicht auf Rechte.'
export function dateValid(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T12:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const val = (v, max) => {
  if (typeof v !== 'string') return ''
  const s = v.trim().replace(/\r\n/g, '\n')
  if (s.length > max) throw new TypeError('Ein Textfeld ist zu lang.')
  return s
}
const de = (v) => v.split('-').reverse().join('.')
export function canManagePersonnel(role) { return role === 'owner' || role === 'admin' }
export function canReadPersonnel(actor, row) {
  return Boolean(actor?.userId && row && (canManagePersonnel(actor.role) || (row.employee_user_id === actor.userId && row.published_at)))
}
export function canAcknowledgePersonnel(actor, row) {
  return Boolean(actor?.userId && row && row.employee_user_id === actor.userId && row.published_at && !row.receipt_at)
}
export function canPublishPersonnel(row) {
  return Boolean(row && !row.published_at && (row.kind === 'warning' || (row.kind === 'termination' && row.paper_delivered_on && row.paper_copy_sha256)))
}
export function makePersonnelText(input, employeeName) {
  const name = val(employeeName, 160)
  if (!name) throw new TypeError('Der Mitarbeitername fehlt.')
  if (input.kind === 'warning') {
    const reason = WARNING_REASONS[input.reason]
    if (!Object.hasOwn(WARNING_REASONS, input.reason) || !reason) throw new TypeError('Bitte einen Abmahnungsgrund auswählen.')
    const date = val(input.incidentDate, 10), time = val(input.incidentTime, 5)
    const location = val(input.location, 180), facts = val(input.facts, 1800), duty = val(input.duty, 650)
    if (!dateValid(date) || (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) || facts.length < 12)
      throw new TypeError('Datum und konkrete Beschreibung des Vorfalls sind erforderlich. Bitte Uhrzeit, Ort und Verhalten soweit bekannt in der Beschreibung angeben.')
    const expected = val(input.expected, 450) || reason[1]
    return { title: 'Abmahnung', reason: reason[0], paragraphs: [
      'Sehr geehrte/r ' + name + ',',
      'hiermit mahnen wir Sie wegen des nachfolgend konkret beschriebenen Verhaltens ab. Grund: ' + reason[0] + '.',
      'Vorfall am ' + de(date) + (time ? ' um ' + time + ' Uhr' : '') + (location ? ', Einsatzort: ' + location : '') + '.',
      facts, ...(duty ? ['Verletzte arbeitsvertragliche Pflicht / Anweisung: ' + duty] : []),
      'Wir beanstanden dieses Verhalten ausdrücklich und fordern Sie auf, Ihre arbeitsvertraglichen Pflichten künftig ordnungsgemäß zu erfüllen. ' + expected,
      'Im Wiederholungsfall müssen Sie mit weiteren arbeitsrechtlichen Maßnahmen bis hin zur Kündigung des Arbeitsverhältnisses rechnen.',
      'Mit freundlichen Grüßen',
    ] }
  }
  if (input.kind !== 'termination' || !Object.hasOwn(TERMINATION_TYPES, input.reason)) throw new TypeError('Ungültige Dokumentart.')
  const extraordinary = input.reason === 'extraordinary'
  const endDate = val(input.endDate, 10)
  if (!extraordinary && !dateValid(endDate)) throw new TypeError('Bitte das geprüfte Beendigungsdatum angeben.')
  if (input.legalReviewed !== true) throw new TypeError('Kündigungsvoraussetzungen und Frist müssen geprüft sein.')
  const extra = val(input.terminationText, 900)
  return { title: TERMINATION_TYPES[input.reason], reason: TERMINATION_TYPES[input.reason], paragraphs: [
    'Sehr geehrte/r ' + name + ',',
    extraordinary
      ? 'hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis außerordentlich und fristlos.'
      : 'hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis ordentlich und fristgerecht zum ' + de(endDate) + ', hilfsweise zum nächstzulässigen Termin.',
    ...(extra ? [extra] : []),
    'Bitte geben Sie sämtliche überlassenen Arbeitsmittel, Schlüssel und Unterlagen nach Absprache zurück.',
    'Bitte beachten Sie die Pflicht zur rechtzeitigen Arbeitsuchendmeldung bei der Agentur für Arbeit nach § 38 SGB III.',
    'Mit freundlichen Grüßen',
  ] }
}
