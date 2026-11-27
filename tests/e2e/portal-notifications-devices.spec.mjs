import {test,expect} from '@playwright/test'
const account=(role)=>({id:role==='admin'?'admin-test':'employee-test',email:role+'@example.test',aud:'',role:'authenticated',app_metadata:{provider:'email',roles:[role]},user_metadata:{full_name:role==='admin'?'Admin Test':'Şivan Test'},created_at:'2026-01-01T00:00:00.000Z',confirmed_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'})
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
function tokenResponse(user){
 const now=Math.floor(Date.now()/1000),token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({aud:'authenticated',sub:user.id,email:user.email,role:'authenticated',exp:now+3600,iat:now,app_metadata:user.app_metadata,user_metadata:user.user_metadata})+'.test-signature'
 return {access_token:token,token_type:'bearer',expires_in:3600,expires_at:now+3600,refresh_token:'test-refresh',user}
}
const fulfill=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
async function login(page,role){
 const user=account(role),employee=account('employee'),received=[],documents=[],notices=[{id:'notice-test',title:'HABUN – Neue Nachricht',body:'Eine neue persönliche Nachricht ist verfügbar.',url:'/?view=mailbox',createdAt:'2026-11-27T09:00:00Z',readAt:null}]
 let authenticated=false
 await page.route('**/.netlify/identity**',async route=>{
  const r=route.request(),u=new URL(r.url())
  if(u.pathname.endsWith('/settings'))return fulfill(route,{disable_signup:false,autoconfirm:true,external:{}})
  if(u.pathname.endsWith('/token')&&r.method()==='POST'){authenticated=true;return fulfill(route,tokenResponse(user))}
  if(u.pathname.endsWith('/user'))return fulfill(route,authenticated?user:{error:'invalid_token'},authenticated?200:401)
  return fulfill(route,{})
 })
 await page.route('**/api/**',async route=>{
  const request=route.request(),u=new URL(request.url()),p=u.pathname,m=request.method()
  if(p==='/api/session')return fulfill(route,{userId:user.id,id:user.id,email:user.email,fullName:user.user_metadata.full_name,role,employeeCount:1})
  if(p==='/api/registrations')return fulfill(route,{employees:[{userId:employee.id,fullName:employee.user_metadata.full_name,status:'active',role:'employee'}],requests:[],archived:[]})
  if(p==='/api/employee-documents')return fulfill(route,{documents:[],unreadCount:0})
  if(p==='/api/portal-notifications'){
   if(m==='POST'){const body=request.postDataJSON();for(const n of notices)if(body.action==='read-all'||n.id===body.id)n.readAt=new Date().toISOString();return fulfill(route,{ok:true})}
   return fulfill(route,{notifications:notices,unreadCount:notices.filter(n=>!n.readAt).length})
  }
  if(p==='/api/portal-messages'){
   if(m==='POST'){
    const body=request.postDataJSON();received.push(body)
    return fulfill(route,{ok:true,id:body.id},201)
   }
   return fulfill(route,{messages:received.map(r=>({id:r.id,senderName:user.user_metadata.full_name,senderUserId:user.id,recipientUserId:r.recipientUserId||null,toAdministration:role!=='admin',subject:r.subject,body:r.body,attachmentName:r.attachment?.name,createdAt:new Date().toISOString(),outgoing:true}))})
  }
  if(p==='/api/personnel-documents'){
   const action=u.searchParams.get('action')
   if(action==='preview')return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.7\n%%EOF')})
   if(action==='create'){const payload=request.postDataJSON();documents.push({...payload,title:'Abmahnung',employeeName:employee.user_metadata.full_name,creatorName:user.user_metadata.full_name,creatorFunction:payload.signerFunction,createdAt:new Date().toISOString(),publishedAt:null,canPublish:true});return fulfill(route,{id:payload.id},201)}
   if(action==='publish'){const d=documents.find(d=>d.id===request.postDataJSON().id);if(d){d.publishedAt=new Date().toISOString();d.canPublish=false}return fulfill(route,{ok:true})}
   return fulfill(route,{documents})
  }
  if(p==='/api/attendance')return fulfill(route,{phase:'idle',events:[],entries:[],schedules:[]})
  if(p==='/api/schedule-v2')return fulfill(route,{entries:[],objects:[]})
  if(p==='/api/company-settings')return fulfill(route,{settings:{companyName:'Habun Security'}})
  if(p==='/api/settings')return fulfill(route,{settings:{}})
  return fulfill(route,{entries:[],reports:[],requests:[],daysOff:[],employees:[],objects:[]})
 })
 await page.goto('/')
 await page.getByLabel('E-Mail-Adresse').fill(user.email)
 await page.getByLabel('Passwort').fill('test-login-password')
 await page.getByRole('button',{name:'Sicher anmelden'}).click()
 await expect(page.getByRole('button',{name:/^Benachrichtigungen \(1 ungelesen\)$/})).toBeVisible()
 return {received,documents}
}
async function checkFits(page,locator){
 await expect(locator).toBeVisible()
 const rect=await locator.boundingBox(),viewport=page.viewportSize()
 expect(rect.x).toBeGreaterThanOrEqual(-1)
 expect(rect.x+rect.width).toBeLessThanOrEqual(viewport.width+2)
}
test('employee gets own notice, opens mailbox, sends text and a PDF attachment',async({page})=>{
 const {received}=await login(page,'employee')
 const bell=page.getByRole('button',{name:/^Benachrichtigungen \(1 ungelesen\)$/})
 await checkFits(page,bell);await bell.click()
 await expect(page.getByRole('heading',{name:'Meine Benachrichtigungen'})).toBeVisible()
 await expect(page.getByText('Eine neue persönliche Nachricht ist verfügbar.')).toBeVisible()
 await page.getByRole('button',{name:'Öffnen',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Nachrichten und Anhänge'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Meine Personalunterlagen'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Personalunterlagen erstellen'})).toHaveCount(0)
 await page.getByLabel('Betreff der Nachricht').fill('Test: Unterlagen')
 await page.getByLabel('Nachricht',{exact:true}).fill('Nur für die Verwaltung.')
 await page.getByLabel(/Anhang \(optional/).setInputFiles({name:'Test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n%%EOF')})
 const send=page.getByRole('button',{name:'Nachricht senden'})
 await checkFits(page,send);await send.click()
 await expect(page.getByText('Nachricht wurde sicher zugestellt.')).toBeVisible()
 expect(received).toHaveLength(1)
 expect(received[0].recipientUserId).toBeUndefined()
 expect(received[0].attachment.name).toBe('Test.pdf')
 await expect(page.getByRole('button',{name:'Anhang herunterladen: Test.pdf'})).toBeVisible()
})
test('administrator targets a specific employee and sees the personnel form',async({page})=>{
 const {received}=await login(page,'admin')
 await page.getByRole('button',{name:/^Benachrichtigungen \(1 ungelesen\)$/}).click()
 await page.getByRole('button',{name:'Öffnen',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Nachrichten und Anhänge'})).toBeVisible()
 await page.getByLabel('Nachricht an').selectOption('employee-test')
 await page.getByLabel('Betreff der Nachricht').fill('Persönliche Antwort')
 await page.getByLabel('Nachricht',{exact:true}).fill('Nur dieser Mitarbeiter erhält die Nachricht.')
 await page.getByRole('button',{name:'Nachricht senden'}).click()
 await expect(page.getByText('Nachricht wurde sicher zugestellt.')).toBeVisible()
 expect(received[0].recipientUserId).toBe('employee-test')
 if(await page.getByRole('button',{name:'Menü öffnen'}).isVisible())await page.getByRole('button',{name:'Menü öffnen'}).click()
 await page.getByRole('button',{name:'Personalunterlagen',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Personalunterlagen erstellen'})).toBeVisible()
 const form=page.locator('.personnel-form').first()
 await form.getByLabel('Mitarbeiter',{exact:true}).selectOption('employee-test')
 await form.getByLabel('Abmahnungsgrund').selectOption('late')
 await form.getByLabel('Datum des Vorfalls').fill('2026-11-27')
 await form.getByLabel('Uhrzeit').fill('06:00')
 await form.getByLabel('Einsatzort / Objekt').fill('Testobjekt')
 await form.getByLabel(/Was ist konkret passiert/).fill('Fiktiver verspäteter Dienstantritt für Browser-Test.')
 await form.getByLabel('Verletzte Pflicht / bekannte Dienstanweisung').fill('Dienstplan')
 await form.getByLabel('Funktion der unterzeichnenden Person').selectOption('Personalverantwortlicher')
 await form.getByLabel(/Ich bin für dieses Schreiben/).check()
 const preview=form.getByRole('button',{name:'PDF-Vorschau herunterladen'})
 await checkFits(page,preview);await expect(preview).toBeEnabled()
 await preview.click()
 await expect(form.locator('canvas')).toBeVisible()
 const canvas=form.locator('canvas'),box=await canvas.boundingBox()
 await checkFits(page,canvas)
 await page.mouse.move(box.x+10,box.y+10)
 await page.mouse.down()
 await page.mouse.move(box.x+60,box.y+40,{steps:5})
 await page.mouse.up()
 await expect(form.getByRole('button',{name:'Unterschriebenes PDF speichern'})).toBeEnabled()
 await form.getByRole('button',{name:'Unterschriebenes PDF speichern'}).click()
 await expect(page.getByText(/Dokument gespeichert/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Ins Postfach senden'})).toBeVisible()
})
