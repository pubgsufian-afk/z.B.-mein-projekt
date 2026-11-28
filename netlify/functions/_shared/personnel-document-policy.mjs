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
  confirmation: 'Kündigungsbestätigung',
}
export const TERMINATION_GROUNDS = {
  none: 'Keine Begründung im Schreiben',
  operational: 'Betriebsbedingte Gründe',
  personal: 'Personenbedingte Gründe',
  conduct: 'Verhaltensbedingte Gründe',
  other: 'Sonstiger rechtlich geprüfter Grund',
}
export const TERMINATION_NOTICE_PARAGRAPHS = [
  'Arbeitsuchendmeldung (§ 38 Abs. 1 SGB III): Melden Sie sich spätestens drei Monate vor dem Ende Ihres Arbeitsverhältnisses bei der Agentur für Arbeit arbeitsuchend. Erfahren Sie weniger als drei Monate vorher von der Beendigung, melden Sie sich innerhalb von drei Tagen nach Kenntnis.',
  'Die Meldepflicht gilt auch dann, wenn Sie gegen die Kündigung vorgehen oder eine Weiterbeschäftigung in Aussicht gestellt wird. Eine verspätete Meldung kann Nachteile beim Arbeitslosengeld verursachen.',
  'Bemühen Sie sich frühzeitig eigenständig um eine neue Beschäftigung. Falls Sie arbeitslos werden, ist zusätzlich eine gesonderte Arbeitslosmeldung erforderlich. Informationen und Online-Dienste: www.arbeitsagentur.de.',
]
export const ACK_TEXT = 'Ich bestätige ausschließlich den Erhalt dieses Dokuments im Portal. Die Bestätigung bedeutet keine Zustimmung zum Inhalt und keinen Verzicht auf Rechte.'
export function makeReceiptText({title,createdAt,receiptAt}) {
  const format=(value,withTime=false)=>{
    const date=new Date(value)
    if(!value||!Number.isFinite(date.getTime()))throw new TypeError('Datum der Empfangsbestätigung fehlt oder ist ungültig.')
    const parts=Object.fromEntries(new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:{})}).formatToParts(date).map(p=>[p.type,p.value]))
    return parts.day+'.'+parts.month+'.'+parts.year+(withTime?', '+parts.hour+':'+parts.minute+' Uhr':'')
  }
  return [ACK_TEXT,'Dokument: '+title,'Dokument erstellt am: '+format(createdAt),'Empfang bestätigt am: '+format(receiptAt,true)]
}
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
// Preserve postal lines; accept a common single-line German address without guessing missing data.
export function addressStartsWithName(value,name) {
  const cleanName=typeof name==='string'?name.trim().replace(/\s+/g,' '):''
  if(!cleanName||!/\p{L}/u.test(cleanName))return false
  const address=typeof value==='string'?value.trim().replace(/\s+/g,' '):''
  const prefix=address.slice(0,cleanName.length).toLocaleLowerCase('de-DE')
  return prefix===cleanName.toLocaleLowerCase('de-DE')&&/^[\s,]/.test(address.slice(cleanName.length))
}
export function normalizePersonnelAddress(value,employeeName='') {
  let address = val(value, 400).replace(/\r/g, '\n').trim()
  // The PDF has a separate recipient name. Remove only an exact, known name,
  // never infer a stranger's name or silently transfer their address.
  if(addressStartsWithName(address,employeeName)){
    const parts=employeeName.trim().split(/\s+/)
    const words=parts.map(x=>x.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&'))
    address=address.replace(new RegExp('^'+words.join('\\s+')+'[\\s,]+','iu'),'')
  }
  const lines=address.split('\n').map(line=>line.trim().replace(/[ \t]+/g,' ')).filter(Boolean)
  const normalized=lines.map(line=>{
    // Split only at a five-digit postcode preceded by an existing house or
    // postbox number. Keep the actual street and locality exactly as entered.
    if(/^\d{5}\s+\p{L}/u.test(line))return line
    const match=/^(.+?\d[\p{L}]?(?:\s*[-/]\s*\d[\p{L}]?)?)[,; ]+\s*(\d{5}\s+\p{L}.*)$/u.exec(line)
    return match?match[1].trim()+'\n'+match[2].trim():line
  })
  return normalized.join('\n')
}
export function validTerminationAddress(value,employeeName='') {
  try {
    const lines=normalizePersonnelAddress(value,employeeName).split('\n')
    if(lines.length<2 || !/\p{L}/u.test(lines[0]))return false
    const postcodeIndex=lines.findIndex((line,i)=>i>0&&/^\d{5}\s+\p{L}/u.test(line))
    if(postcodeIndex>0)return lines.slice(0,postcodeIndex).some(line=>/\p{L}/u.test(line)&&/\d/.test(line))
    return lines.length>=3 && /\p{L}/u.test(lines.at(-2)) && /^[\p{L}][\p{L} .'-]{1,60}$/u.test(lines.at(-1)) && !/^(Deutschland|Germany)$/i.test(lines.at(-1))
  } catch { return false }
}
export function recipientNameValid(value) {
  return typeof value==='string' && /\p{L}/u.test(value.trim())
}
export function addressMatchesOtherAccount(value,employeeName,accountName) {
  return Boolean(accountName&&employeeName&&accountName.trim().toLocaleLowerCase('de-DE')!==employeeName.trim().toLocaleLowerCase('de-DE')&&addressStartsWithName(value,accountName))
}
export function defaultSignerFunction(name) {
  return String(name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('de-DE')==='marwan ziad'?'Inhaber':'Bevollmächtigter'
}
const de = (v) => v.split('-').reverse().join('.')
const longDate = v => new Intl.DateTimeFormat('de-DE',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'T12:00:00Z'))
export function terminationSalutation(input,name) {
  const mode=input.salutation||'neutral'
  if(!['neutral','herr','frau'].includes(mode))throw new TypeError('Ungültige Anrede.')
  if(mode==='neutral')return 'Guten Tag '+name+','
  const surname=val(input.surname,120)
  if(!surname||/[\r\n]/.test(surname))throw new TypeError('Bitte den Nachnamen für die persönliche Anrede prüfen und eintragen.')
  return (mode==='herr'?'Sehr geehrter Herr ':'Sehr geehrte Frau ')+surname+','
}
export function canManagePersonnel(role) { return role === 'owner' || role === 'admin' }
export function personnelLifecycleAction(row) {
  if (!row || row.lifecycle_action) return null
  if (row.receipt_at || row.paper_delivered_on) return 'cancel'
  return row.published_at ? 'withdraw' : 'delete'
}
export function suggestedSurname(fullName) {
  const parts=String(fullName||'').trim().split(/\s+/)
  return parts.length>1 ? parts.at(-1) : ''
}
export function canReadPersonnel(actor, row) {
  return Boolean(actor?.userId && row && row.lifecycle_action !== 'delete' && (canManagePersonnel(actor.role) || (row.employee_user_id === actor.userId && row.published_at)))
}
export function canAcknowledgePersonnel(actor, row) {
  return Boolean(actor?.userId && row && row.employee_user_id === actor.userId && row.published_at && !row.receipt_at && !row.lifecycle_action)
}
export function canPublishPersonnel(row) {
  return Boolean(row && !row.lifecycle_action && !row.published_at && (row.kind === 'warning' || (row.kind === 'termination' && row.paper_delivered_on && row.paper_copy_sha256)))
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
  const confirmation = input.reason === 'confirmation'
  const endDate = val(input.endDate, 10)
  if (!extraordinary && !dateValid(endDate)) throw new TypeError('Bitte das geprüfte Beendigungsdatum angeben.')
  if (input.legalReviewed !== true) throw new TypeError('Die Angaben und rechtlichen Voraussetzungen müssen geprüft sein.')
  const greeting=terminationSalutation(input,name)
  if(confirmation){
    const resignationDate=val(input.resignationDate,10)
    if(!dateValid(resignationDate)||resignationDate>endDate)throw new TypeError('Bitte das Datum der Eigenkündigung und das Beendigungsdatum prüfen.')
    if(input.employeeResignationConfirmed!==true)throw new TypeError('Bitte bestätigen, dass die Eigenkündigung des Mitarbeiters tatsächlich vorliegt.')
    return {title:'Kündigungsbestätigung',reason:TERMINATION_TYPES.confirmation,paragraphs:[
      greeting,
      'hiermit bestätigen wir den Eingang Ihrer Kündigung vom '+de(resignationDate)+', mit der Sie das Arbeitsverhältnis zum '+longDate(endDate)+' beenden.',
      'Wir nehmen Ihre Kündigung zur Kenntnis und bestätigen, dass das Arbeitsverhältnis mit Ablauf des '+longDate(endDate)+' endet.',
      'Wir danken Ihnen für die Zusammenarbeit und wünschen Ihnen für Ihre berufliche und persönliche Zukunft alles Gute.',
      'Mit freundlichen Grüßen',
    ]}
  }
  const ground=input.terminationGround||'none'
  if(!Object.hasOwn(TERMINATION_GROUNDS,ground))throw new TypeError('Ungültiger Kündigungsgrund.')
  const extra=val(input.terminationText,900)
  if(ground==='other'&&!extra)throw new TypeError('Bitte den sonstigen Kündigungsgrund konkret angeben.')
  const groundText={operational:' aus betriebsbedingten Gründen',personal:' aus personenbedingten Gründen',conduct:' aus verhaltensbedingten Gründen'}[ground]||''
  const first=extraordinary
    ? 'hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis aus wichtigem Grund außerordentlich und fristlos mit Wirkung ab Zugang dieses Schreibens.'
    : input.reason==='probation'
      ? 'hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis während der vereinbarten Probezeit fristgerecht zum '+longDate(endDate)+', hilfsweise zum nächstzulässigen Termin'+groundText+'.'
      : 'hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis ordentlich und fristgerecht zum '+longDate(endDate)+', hilfsweise zum nächstzulässigen Termin'+groundText+'.'
  return {title:input.reason==='probation'?'Kündigung des Arbeitsverhältnisses in der Probezeit':TERMINATION_TYPES[input.reason],reason:TERMINATION_TYPES[input.reason],paragraphs:[
    greeting,first,
    ...(extraordinary&&groundText?['Kündigungsgrund: '+TERMINATION_GROUNDS[ground]+'.']:[]),
    ...(extra?[extra]:[]),
    ...TERMINATION_NOTICE_PARAGRAPHS,
    'Mit freundlichen Grüßen',
  ]}
}
