export const WARNING_REASONS = {
  late: ['Verspäteter Dienstantritt', 'Erscheine künftig pünktlich und arbeitsbereit zum vereinbarten Dienstbeginn.'],
  absence: ['Unentschuldigtes Fehlen / Nichterscheinen', 'Tritt die vereinbarten Dienste an und melde eine Verhinderung unverzüglich nach den geltenden Vorgaben.'],
  departure: ['Unerlaubtes Verlassen des Arbeitsplatzes', 'Verlasse den Einsatzort während des Dienstes nur nach den geltenden Anweisungen.'],
  sleep: ['Schlafen im Dienst', 'Halte dich während des Dienstes einsatzbereit und erfülle die vereinbarten Aufgaben.'],
  instructions: ['Missachtung einer Dienstanweisung', 'Beachte die rechtmäßigen und dir bekannt gegebenen Dienstanweisungen.'],
  patrol: ['Kontrollgang / Rundgang nicht durchgeführt', 'Führe die vorgeschriebenen Kontrollgänge ordnungsgemäß durch und dokumentiere sie.'],
  access: ['Verstoß gegen Zutrittskontrolle / Schlüsselregelung', 'Beachte die vorgeschriebenen Zutritts-, Schlüssel- und Übergaberegelungen.'],
  firewatch: ['Verstoß gegen Brandwache / Sicherheitsvorgaben', 'Beachte die für deinen Einsatz geltenden Sicherheits- und Brandwachanweisungen.'],
  gmp: ['Verstoß gegen Hygiene-, GMP- oder Arbeitsschutzvorgaben', 'Beachte die geltenden und dir bekannt gegebenen Hygiene- und Arbeitsschutzanweisungen.'],
  cleaning: ['Reinigungsauftrag nicht ordnungsgemäß ausgeführt', 'Führe die vereinbarten Reinigungsarbeiten gemäß den konkreten Arbeitsanweisungen aus.'],
  attendance: ['Fehlende oder fehlerhafte Zeiterfassung', 'Erfasse deine tatsächlichen Arbeitszeiten vollständig und korrekt; melde technische Probleme unverzüglich.'],
  falsification: ['Unrichtige Angaben / Manipulation der Zeiterfassung', 'Mache vollständige und wahrheitsgemäße Angaben zu deinen Arbeitszeiten und Tätigkeiten.'],
  clothes: ['Dienstkleidung / Schutzausrüstung nicht getragen', 'Trage die für deinen Einsatz vorgeschriebene Kleidung und Schutzausrüstung.'],
  phone: ['Unzulässige private Handynutzung im Dienst', 'Beachte die für deinen Einsatz geltenden Regeln zur privaten Handynutzung.'],
  conduct: ['Unangemessenes Verhalten gegenüber Kunden oder Kollegen', 'Verhalte dich respektvoll und professionell gegenüber Kunden, Kollegen und Vorgesetzten.'],
  refusal: ['Verweigerung einer rechtmäßigen Arbeitsanweisung', 'Erfülle deine arbeitsvertraglichen Pflichten und befolge rechtmäßige Arbeitsanweisungen.'],
  reporting: ['Unterlassene Meldung eines Vorfalls / Dienstübergabe', 'Melde relevante Vorfälle und führe die vorgeschriebenen Übergaben ordnungsgemäß durch.'],
  confidentiality: ['Verstoß gegen Verschwiegenheit / Datenschutz', 'Beachte die geltenden Verschwiegenheits- und Datenschutzpflichten.'],
  other: ['Sonstiger konkreter Pflichtverstoß', 'Unterlasse den beschriebenen Pflichtverstoß künftig und erfülle deine arbeitsvertraglichen Pflichten.'],
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
    if (!dateValid(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !location || facts.length < 20 || !duty)
      throw new TypeError('Datum, Uhrzeit, Einsatzort, konkreter Vorfall (mind. 20 Zeichen) und verletzte Pflicht sind erforderlich.')
    const expected = val(input.expected, 450) || reason[1]
    return { title: 'Abmahnung', reason: reason[0], paragraphs: [
      'Sehr geehrte/r ' + name + ',',
      'hiermit mahnen wir Sie wegen des nachfolgend konkret beschriebenen Verhaltens ab.',
      'Vorfall am ' + de(date) + ' um ' + time + ' Uhr, Einsatzort: ' + location + '.',
      facts, 'Verletzte arbeitsvertragliche Pflicht / Anweisung: ' + duty,
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
