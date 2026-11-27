import assert from 'node:assert/strict'
import { canManagePersonnel, canReadPersonnel, canAcknowledgePersonnel, canPublishPersonnel, makePersonnelText, dateValid, WARNING_REASONS } from '../netlify/functions/_shared/personnel-document-policy.mjs'
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
assert.ok(makePersonnelText({kind:'termination',reason:'ordinary',endDate:'2026-12-31',legalReviewed:true},'Testperson').paragraphs.join(' ').includes('31.12.2026'))
console.log('Personnel policy tests passed')
