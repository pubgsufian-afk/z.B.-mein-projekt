import assert from 'node:assert/strict'
import { canManagePersonnel, canReadPersonnel, canAcknowledgePersonnel, canPublishPersonnel, makePersonnelText, makeReceiptText, dateValid, WARNING_REASONS, TERMINATION_NOTICE_TITLE, TERMINATION_NOTICE_PARAGRAPHS, normalizePersonnelAddress, validTerminationAddress } from '../netlify/functions/_shared/personnel-document-policy.mjs'
const employee={userId:'e1',role:'employee'}, other={userId:'e2',role:'employee'}, admin={userId:'a1',role:'admin'}
const row={employee_user_id:'e1',kind:'warning',published_at:null}
assert.equal(canManagePersonnel('manager'),false)
assert.equal(canManagePersonnel('owner'),true)
assert.equal(canReadPersonnel(employee,row),false)
assert.equal(canReadPersonnel(admin,row),true)
assert.equal(canPublishPersonnel(row),true)
row.published_at='2026-11-27'
assert.equal(canReadPersonnel(employee,row),true)
assert.equal(canReadPersonnel(other,row),false)
assert.equal(canAcknowledgePersonnel(other,row),false)
assert.equal(canAcknowledgePersonnel(employee,row),true)
assert.equal(canAcknowledgePersonnel(employee,{...row,receipt_at:'now'}),false)
assert.equal(canPublishPersonnel({kind:'termination'}),false)
assert.equal(canPublishPersonnel({kind:'termination',paper_delivered_on:'2026-11-27',paper_copy_sha256:'hash'}),true)
assert.equal(dateValid('2026-02-31'),false)
assert.throws(()=>makePersonnelText({kind:'warning',reason:'late'},'Test'))
assert.throws(()=>makePersonnelText({kind:'termination',reason:'ordinary',endDate:'2026-12-31'},'Test'))
assert.throws(()=>makePersonnelText({kind:'warning',reason:'__proto__'},'Test'))
for(const reason of Object.keys(WARNING_REASONS)){
 const result=makePersonnelText({kind:'warning',reason,incidentDate:'2026-11-27',incidentTime:'06:00',location:'Testobjekt',facts:'Konkreter fiktiver Vorfall, vollständig beschrieben.',duty:'Bekannte Dienstanweisung'},'Testperson')
 assert.equal(result.title,'Abmahnung')
 assert.ok(result.paragraphs.join(' ').includes('27.11.2026'))
}
assert.ok(makePersonnelText({kind:'termination',reason:'ordinary',endDate:'2026-12-31',legalReviewed:true},'Testperson').paragraphs.join(' ').includes('31. Dezember 2026'))
console.log('Personnel policy tests passed')

const quick=makePersonnelText({kind:'warning',reason:'late',incidentDate:'2026-11-27',facts:'Um 06:25 statt 06:00 Uhr am Testobjekt erschienen.'},'Testperson')
assert.ok(quick.paragraphs.join(' ').includes('06:25'))
assert.ok(!quick.paragraphs.join(' ').includes('Einsatzort: .'))
assert.throws(()=>makePersonnelText({kind:'warning',reason:'late',incidentDate:'2026-11-27',facts:'zu spät'},'Testperson'))

for(const reason of ['ordinary','probation','extraordinary']){
 const result=makePersonnelText({kind:'termination',reason,endDate:'2026-12-31',legalReviewed:true},'Testperson')
 assert.doesNotMatch(result.paragraphs.join(' '),/Arbeitsuchendmeldung|Agentur für Arbeit|§ 38 SGB III/)
 assert.match(result.paragraphs.join(' '),reason==='extraordinary'?/außerordentlich und fristlos/:/31\. Dezember 2026/)
}
assert.match(TERMINATION_NOTICE_TITLE,/Merkblatt/)
assert.match(TERMINATION_NOTICE_PARAGRAPHS.join(' '),/drei Monate/)
assert.match(TERMINATION_NOTICE_PARAGRAPHS.join(' '),/drei Tagen/)
assert.match(TERMINATION_NOTICE_PARAGRAPHS.join(' '),/§ 38/)

const example={kind:'termination',endDate:'2026-12-31',legalReviewed:true}
const ordinary=makePersonnelText({...example,reason:'ordinary'},'Testperson')
const probation=makePersonnelText({...example,reason:'probation'},'Testperson')
const extraordinary=makePersonnelText({...example,reason:'extraordinary',endDate:''},'Testperson')
assert.notDeepEqual(ordinary.paragraphs,probation.paragraphs)
assert.match(probation.paragraphs.join(' '),/während der vereinbarten Probezeit/)
assert.doesNotMatch(ordinary.paragraphs.join(' '),/Probezeit/)
assert.match(extraordinary.paragraphs.join(' '),/wichtige[mn] Grund.*ab Zugang/)
assert.equal(normalizePersonnelAddress('Teststraße 1, 12345 Teststadt'),'Teststraße 1\n12345 Teststadt')
assert.equal(normalizePersonnelAddress(' Teststraße 1\r\n 12345 Teststadt '),'Teststraße 1\n12345 Teststadt')
assert.equal(validTerminationAddress('Kksks'),false)
assert.equal(validTerminationAddress('Teststraße 1\n12345 Teststadt'),true)
assert.equal(validTerminationAddress('Teststraße 1\nTeststadt\nDeutschland'),false)

assert.equal(validTerminationAddress('Teststraße\n12345 Teststadt'),false)
assert.equal(validTerminationAddress('Postfach 123\n12345 Teststadt'),true)

const receiptText=makeReceiptText({title:'Abmahnung',createdAt:'2026-11-26T23:30:00Z',receiptAt:'2026-11-27T17:28:45.772Z',id:'internal-id',sha256:'private-hash'})
assert.deepEqual(receiptText.slice(1),['Dokument: Abmahnung','Dokument erstellt am: 27.11.2026','Empfang bestätigt am: 27.11.2026, 18:28 Uhr'])
assert.doesNotMatch(receiptText.join(' '),/SHA-256|Dokument-ID|Dokumentreferenz|internal-id|private-hash/)
assert.match(receiptText[0],/keine Zustimmung/)
assert.match(makeReceiptText({title:'Abmahnung',createdAt:'2026-07-01T10:00:00Z',receiptAt:'2026-07-01T10:00:00Z'}).at(-1),/12:00 Uhr/)

const letter=makePersonnelText({...example,reason:'probation',salutation:'herr',surname:'Testperson',terminationGround:'operational',includeEmploymentNotice:true},'Max Testperson')
assert.equal(letter.title,'Kündigung des Arbeitsverhältnisses in der Probezeit')
assert.equal(letter.paragraphs[0],'Sehr geehrter Herr Testperson,')
assert.match(letter.paragraphs[1],/aus betriebsbedingten Gründen/)
assert.match(letter.paragraphs.join(' '),/Agentur für Arbeit/)
const confirmInput={...example,reason:'confirmation',resignationDate:'2026-11-27',employeeResignationConfirmed:true,salutation:'frau',surname:'Testperson'}
const confirmation=makePersonnelText(confirmInput,'Eva Testperson')
assert.equal(confirmation.title,'Kündigungsbestätigung')
assert.equal(confirmation.paragraphs[0],'Sehr geehrte Frau Testperson,')
assert.match(confirmation.paragraphs[1],/Eingang Ihrer Kündigung vom 27.11.2026/)
assert.doesNotMatch(confirmation.paragraphs.join(' '),/hiermit kündigen|Agentur für Arbeit/)
assert.throws(()=>makePersonnelText({...confirmInput,employeeResignationConfirmed:false},'Eva Testperson'))
assert.throws(()=>makePersonnelText({...confirmInput,resignationDate:'2027-01-01'},'Eva Testperson'))
assert.throws(()=>makePersonnelText({...example,reason:'ordinary',salutation:'herr',surname:''},'Testperson'))
assert.throws(()=>makePersonnelText({...example,reason:'ordinary',terminationGround:'other'},'Testperson'))
