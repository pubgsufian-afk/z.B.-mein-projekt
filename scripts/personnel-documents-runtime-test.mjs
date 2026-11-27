import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { deflateSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { PDFDocument, PDFArray } from 'pdf-lib'
// Isolated integration test: real authorization, PDF rendering, and API routes;
// fake identity, database and push delivery; no access to actual employee data.
const state={actor:null,rows:new Map(),access:{
 'a':{role:'admin',status:'active',fullName:'Verwaltung Test'},
 'e1':{role:'employee',status:'active',fullName:'Şivan Çelik'},
 'e2':{role:'employee',status:'active',fullName:'Person Zwei'},
 'manager':{role:'manager',status:'active',fullName:'Einsatzleitung Test'},
 'inactive':{role:'employee',status:'inactive',fullName:'Inaktiv Test'},
},push:[]}
globalThis.__personnelTest=state
globalThis.Netlify={env:{get:()=>''}}
function query(sql,p=[]){
 const q=sql.toLowerCase().replace(/\s+/g,' ')
 const row=state.rows.get(p[0]), ok=r=>({rows:r?[r]:[]})
 if(q.startsWith('select full_name from schedule_employees'))return {rows:[]}
 if(q.startsWith('select ')&&q.includes(' from personnel_documents')){
  if(q.includes(' where id=$1'))return ok(row)
  if(q.includes(' where employee_user_id=$1'))return {rows:[...state.rows.values()].filter(r=>r.employee_user_id===p[0]&&r.published_at)}
  return {rows:[...state.rows.values()]}
 }
 if(q.startsWith('insert into personnel_documents')){
  if(row)return ok(null)
  const [id,employee_user_id,employee_name,creator_user_id,creator_name,creator_function,kind,title,reason,pdf_base64,pdf_sha256]=p
  const created={id,employee_user_id,employee_name,creator_user_id,creator_name,creator_function,kind,title,reason,pdf_base64,pdf_sha256,created_at:new Date().toISOString(),published_at:null,first_opened_at:null,paper_delivered_on:null,paper_copy_sha256:null,receipt_at:null}
  state.rows.set(id,created);return ok({id})
 }
 if(q.startsWith('update personnel_documents set first_opened_at')){
  if(row)row.first_opened_at||=new Date().toISOString()
  return ok(null)
 }
 if(q.startsWith('update personnel_documents set receipt_at')){
  if(!row||row.employee_user_id!==p[1]||!row.published_at||row.receipt_at)return ok(null)
  row.receipt_at=new Date().toISOString();row.receipt_signature=p[2];row.receipt_document_sha256=row.paper_copy_sha256||row.pdf_sha256
  return ok({id:row.id})
 }
 if(q.startsWith('update personnel_documents set paper_delivered_on')){
  if(!row||row.kind!=='termination'||row.published_at||row.paper_delivered_on)return ok(null)
  Object.assign(row,{paper_delivered_on:p[1],paper_delivery_note:p[2],paper_copy_base64:p[3],paper_copy_sha256:p[4],paper_recorded_by:p[5]});return ok({id:row.id})
 }
 if(q.startsWith('update personnel_documents set published_at')){
  if(!row||row.published_at||(row.kind==='termination'&&(!row.paper_delivered_on||!row.paper_copy_sha256)))return ok(null)
  row.published_at=new Date().toISOString();row.published_by=p[1];return ok({id:row.id})
 }
 throw Error('Unhandled test SQL: '+sql)
}
state.query=query
const mocks={
 '@netlify/identity':"export async function getUser(){return globalThis.__personnelTest.actor} export function verifyRequestOrigin(r){if(r.headers.get('x-invalid-origin'))throw Error('origin')}",
 '@netlify/database':"export function getDatabase(){return {pool:{query:(q,p)=>globalThis.__personnelTest.query(q,p)}}}",
 '@netlify/blobs':"export function getStore({name}){return {get:async k=>name==='portal-access'?globalThis.__personnelTest.access[k.slice(7)]||null:null}} export const getDeployStore=getStore",
 './_shared/push-core.mts':"export async function sendPushToUsers(o){globalThis.__personnelTest.push.push(o);return {targeted:1,delivered:1}}",
}
const bundled=await build({entryPoints:['netlify/functions/personnel-documents.mts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'mock-personnel',setup(c){c.onResolve({filter:/^@netlify\/(identity|database|blobs)$|^\.\/_shared\/push-core\.mts$/},a=>({path:a.path,namespace:'mock'}));c.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}))}}]})
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const select=id=>{state.actor=id?{id,email:id+'@example.test'}:null}
function call(action='list',body,context='deploy-preview',invalidOrigin=false){
 const method=body?'POST':'GET'
 return handler(new Request('https://example.test/api/personnel-documents?action='+action,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json',...(invalidOrigin?{'x-invalid-origin':'1'}:{})}}:{})}),{deploy:{context}})
}
// Real deterministic PNG, with a synthetic diagonal signature.
function crc32(buf){let c=0xffffffff;for(const byte of buf){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){const header=Buffer.alloc(8);header.writeUInt32BE(data.length);header.write(type,4);const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),data])));return Buffer.concat([header,data,checksum])}
function testPng(){const w=800,h=250,head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){for(let x=0;x<w;x++){const i=y*(w*4+1)+1+x*4;if(Math.abs(y-(x/4+20))<3)raw[i+3]=255}}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const sig='data:image/png;base64,'+testPng().toString('base64')
const id=randomUUID(), warning={id,kind:'warning',employeeUserId:'e1',reason:'late',incidentDate:'2026-11-27',incidentTime:'06:00',location:'Testobjekt',facts:'Fiktiver verspäteter Dienstantritt für Integrationstest.',duty:'Verbindlicher Dienstplan',signerFunction:'Personalverantwortlicher',authorized:true,signature:sig,creatorName:'Manipulierter Name'}
select(null);assert.equal((await call()).status,401)
select('e1');assert.equal((await call('create',warning)).status,403)
select('manager');assert.equal((await call('create',warning)).status,403)
select('a');assert.equal((await call('create',warning,'deploy-preview',true)).status,403)
assert.equal((await call('create',{...warning,employeeUserId:'inactive'})).status,409)
assert.equal((await call('create',{...warning,signature:''})).status,400)
const preview=await call('preview',warning);assert.equal(preview.status,200);assert.ok((await PDFDocument.load(await preview.arrayBuffer())).getPageCount()>0);assert.equal(state.rows.size,0)
// A general printable notice is admin-only and never creates a personnel record.
select('e1');assert.equal((await call('termination-notice')).status,403)
select('manager');assert.equal((await call('termination-notice')).status,403)
select('a');const notice=await call('termination-notice');assert.equal(notice.status,200)
assert.match(notice.headers.get('content-disposition'),/Merkblatt-zur-Kuendigung\.pdf/)
assert.equal((await PDFDocument.load(await notice.arrayBuffer())).getPageCount(),1)
assert.equal(state.rows.size,0);assert.equal(state.push.length,0)
const created=await call('create',warning);assert.equal(created.status,201,await created.clone().text())
assert.equal(state.rows.get(id).creator_name,'Verwaltung Test')
assert.equal((await call('create',warning)).status,409)
select('e1');assert.equal((await (await call()).json()).documents.length,0);assert.equal((await call('download&id='+id)).status,404)
select('a');assert.equal((await call('publish',{id})).status,200);assert.equal(state.push.length,0)
assert.equal((await call('publish',{id})).status,409)
select('e2');assert.equal((await (await call()).json()).documents.length,0);assert.equal((await call('download&id='+id)).status,404);assert.equal((await call('acknowledge',{id,accepted:true,signature:sig})).status,409)
select('e1');const list=await (await call()).json();assert.equal(list.documents.length,1);assert.equal(list.documents[0].canAcknowledge,true);assert.ok(!('pdf_base64' in list.documents[0]))
const downloaded=await call('download&id='+id);assert.equal(downloaded.status,200);assert.ok((await PDFDocument.load(await downloaded.arrayBuffer())).getPageCount()>0)
assert.equal((await call('acknowledge',{id,accepted:false,signature:sig})).status,400)
assert.equal((await call('acknowledge',{id,accepted:true,signature:sig})).status,200)
assert.equal((await call('acknowledge',{id,accepted:true,signature:sig})).status,409)
const receipt=await call('receipt&id='+id);assert.equal(receipt.status,200);assert.ok((await PDFDocument.load(await receipt.arrayBuffer())).getPageCount()>0)
const confirmed=state.rows.get(id)
assert.equal(confirmed.receipt_document_sha256,confirmed.pdf_sha256)
assert.equal(confirmed.receipt_signature,sig)
const originalHash=confirmed.receipt_document_sha256,originalId=confirmed.id
const originalReceipt=await drawingStreams(await call('receipt&id='+id))
try {
 confirmed.receipt_document_sha256='0'.repeat(64);confirmed.id=randomUUID()
 assert.deepEqual(await drawingStreams(await call('receipt&id='+id)),originalReceipt)
} finally {confirmed.receipt_document_sha256=originalHash;confirmed.id=originalId}
select('e2');assert.equal((await call('receipt&id='+id)).status,404)
select('a');const tid=randomUUID(), termination={id:tid,kind:'termination',employeeUserId:'e1',reason:'ordinary',endDate:'2026-12-31',address:'Teststraße 1, 12345 Teststadt',signerFunction:'Inhaber',authorized:true,legalReviewed:true}
assert.equal((await call('create',{...termination,legalReviewed:false})).status,400)
assert.equal((await call('preview',{...termination,address:'Kksks'})).status,400)
for(const reason of ['ordinary','probation','extraordinary']){
 const response=await call('preview',{...termination,reason,address:'Teststraße 1\n12345 Teststadt',endDate:reason==='extraordinary'?'':termination.endDate})
 assert.equal(response.status,200)
 assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(),1)
}
const confirmationInput={...termination,id:randomUUID(),reason:'confirmation',resignationDate:'2026-01-01',employeeResignationConfirmed:true,salutation:'frau',surname:'Çelik'}
assert.equal((await call('preview',{...confirmationInput,employeeResignationConfirmed:false})).status,400)
const confirmationPreview=await call('preview',confirmationInput)
assert.equal(confirmationPreview.status,200)
assert.equal((await PDFDocument.load(await confirmationPreview.arrayBuffer())).getPageCount(),1)
const withNotice=await call('preview',{...termination,reason:'probation',terminationGround:'operational',includeEmploymentNotice:true,salutation:'herr',surname:'Çelik'})
assert.equal(withNotice.status,200)
assert.equal((await PDFDocument.load(await withNotice.arrayBuffer())).getPageCount(),1)
assert.equal(state.rows.size,1)
// Compare actual PDF drawing streams, not metadata: a different internal ID
// must not affect the visible termination PDF. Warning references remain visible.
async function drawingStreams(response){
 assert.equal(response.status,200)
 const pdf=await PDFDocument.load(await response.arrayBuffer())
 return pdf.getPages().map(page=>{
  const contents=page.node.Contents()
  const streams=contents instanceof PDFArray?contents.asArray():[contents]
  return streams.map(stream=>Buffer.from(pdf.context.lookup(stream).getContents()).toString('base64'))
 })
}
assert.notDeepEqual(await drawingStreams(await call('preview',warning)),await drawingStreams(await call('preview',{...warning,id:randomUUID()})))
assert.deepEqual(await drawingStreams(await call('preview',termination)),await drawingStreams(await call('preview',{...termination,id:randomUUID()})))
const tc=await call('create',termination);assert.equal(tc.status,201,await tc.clone().text())
assert.equal(state.rows.get(tid).id,tid)
assert.match(state.rows.get(tid).pdf_sha256,/^[a-f0-9]{64}$/)
assert.equal((await call('publish',{id:tid})).status,409)
assert.equal((await call('record-paper',{id:tid,deliveredOn:'2026-01-01',deliveryNote:'Persönlich gegen Empfang',paperConfirmed:false,copy:state.rows.get(tid).pdf_base64})).status,400)
assert.equal((await call('record-paper',{id:tid,deliveredOn:'2026-01-01',deliveryNote:'Persönlich gegen Empfang',paperConfirmed:true,copy:state.rows.get(tid).pdf_base64})).status,200)
assert.equal((await call('publish',{id:tid},'production')).status,200)
assert.deepEqual(state.push.map(p=>p.userIds),[['e1']]);assert.ok(!state.push[0].body.includes('Kündigung'))
select('e2');assert.equal((await call('download&id='+tid)).status,404)
select('e1');assert.equal((await call('download&id='+tid)).status,200)
console.log('Personnel documents API, PDF, access and receipt tests passed')
