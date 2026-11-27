import { withDeploymentContext } from './_shared/portal-notification-storage.mts'
import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { createHash } from 'node:crypto'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { requirePortalRole } from './_shared/portal-role.mts'
import { readCompanySettings } from './_shared/company-settings.mts'
import { readPdfLogoBytes } from './_shared/pdf-branding.mts'
import { sendPushToUsers } from './_shared/push-core.mts'
import { notifyPortalAdmins, notifyPortalUsers } from './_shared/portal-notification-service.mts'
import { ACK_TEXT, TERMINATION_NOTICE_TITLE, TERMINATION_NOTICE_PARAGRAPHS, makePersonnelText, dateValid, normalizePersonnelAddress, validTerminationAddress, canManagePersonnel, canReadPersonnel, canAcknowledgePersonnel, canPublishPersonnel } from './_shared/personnel-document-policy.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SIGNER_FUNCTIONS = new Set(['Inhaber', 'Geschäftsführer', 'Personalverantwortlicher', 'Einsatzleiter', 'Bevollmächtigter'])
const metadata = 'id, employee_user_id, employee_name, creator_user_id, creator_name, creator_function, kind, title, reason, created_at, published_at, first_opened_at, paper_delivered_on, paper_copy_sha256, receipt_at'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers })
const clean = (v: unknown, n = 160) => typeof v === 'string' ? v.trim().replace(/[\r\n\t]+/g, ' ').slice(0,n) : ''
const isProduction = (context: Context) => context.deploy?.context === 'production'
async function accessRecord(id: string) {
  return await getStore({ name: 'portal-access', consistency: 'strong' }).get('access/' + id, {type:'json'}) as { fullName?: string; role?: string; status?: string } | null
}
async function accountName(db: ReturnType<typeof getDatabase>, id: string, record: Awaited<ReturnType<typeof accessRecord>>, fallback = '') {
  if (clean(record?.fullName)) return clean(record?.fullName)
  const rows = await db.pool.query('SELECT full_name FROM schedule_employees WHERE user_id = $1 LIMIT 1',[id])
  return clean(rows.rows[0]?.full_name) || clean(fallback)
}
function signature(v: unknown) {
  if (typeof v !== 'string' || !v.startsWith('data:image/png;base64,') || v.length > 220000) throw new TypeError('Bitte eigenhändig im Unterschriftsfeld unterschreiben.')
  const bytes = Buffer.from(v.slice(22), 'base64')
  if (bytes.length < 60 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) > 1200 || bytes.readUInt32BE(20) > 500) throw new TypeError('Ungültige Unterschrift.')
  return bytes
}
function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+filename+'"','Content-Security-Policy':'sandbox'}})
}
const dateLabel = (d: Date) => new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeZone:'Europe/Berlin'}).format(d)
async function renderPdf(input: { title: string; paragraphs: string[]; employeeName: string; address?: string; signerName: string; signerFunction: string; issued: Date; signatureBytes?: Buffer; reference: string; receipt?: boolean; notice?: boolean; showReference?: boolean }) {
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const fontRoot=resolve(process.cwd(),'node_modules/dejavu-fonts-ttf/ttf')
  const [regularBytes,boldBytes]=await Promise.all([readFile(resolve(fontRoot,'DejaVuSans.ttf')),readFile(resolve(fontRoot,'DejaVuSans-Bold.ttf'))])
  const font = await pdf.embedFont(regularBytes,{subset:true})
  const bold = await pdf.embedFont(boldBytes,{subset:true})
  const regularSet=new Set(font.getCharacterSet()),boldSet=new Set(bold.getCharacterSet())
  function checkText(text:string,strong:boolean){
    const supported=strong?boldSet:regularSet
    for(const c of text)if(c!=='\n'&&!supported.has(c.codePointAt(0)!))throw new TypeError('Ein Zeichen wird von der PDF-Schrift nicht unterstützt. Der Name darf nicht verändert werden.')
  }
  const logo = await pdf.embedPng((await readPdfLogoBytes()).bytes)
  let page = pdf.addPage([595.28, 841.89]), y = 0
  const width=475, margin=60
  function pageHeader() {
    const image=logo.scaleToFit(115,55)
    page.drawImage(logo,{x:margin,y:page.getHeight()-48-image.height,width:image.width,height:image.height})
    y=page.getHeight()-120
    line(settings.companyName,11,true)
    line(settings.address,10)
    line(settings.email,10)
    y-=17
  }
  function line(text: string, size=11, strong=false) {
    const f=strong?bold:font
    checkText(text,strong)
    if(y<75){page=pdf.addPage([595.28,841.89]);y=page.getHeight()-60}
    page.drawText(text,{x:margin,y,size,font:f,color:rgb(.1,.1,.1)})
    y-=size+5
  }
  function paragraph(text:string,size=11,strong=false,after=10) {
    const f=strong?bold:font
    checkText(text,strong)
    for(const block of text.split('\n')){
      let current=''
      for(const word of block.split(/\s+/)){
        const candidate=current?current+' '+word:word
        let w=0
        try {w=f.widthOfTextAtSize(candidate,size)} catch {throw new TypeError('Die PDF-Schrift unterstützt nicht alle eingegebenen Zeichen.')}
        if(w<=width){current=candidate;continue}
        if(current)line(current,size,strong)
        current=''
        for(const char of word){
          if(f.widthOfTextAtSize(current+char,size)>width){line(current,size,strong);current=''}
          current+=char
        }
      }
      if(current)line(current,size,strong)
    }
    y-=after
  }
  pageHeader()
  if(!input.notice)paragraph(input.employeeName,12,true,input.address?0:10)
  if(input.address)paragraph(input.address,11)
  paragraph('Hannover, '+dateLabel(input.issued),10)
  paragraph(input.title,16,true)
  for(const p of input.paragraphs)paragraph(p)
  if(input.notice){pdf.setTitle(input.title);return Buffer.from(await pdf.save())}
  if(y<150){page=pdf.addPage([595.28,841.89]);y=page.getHeight()-60}
  if(input.signatureBytes){
    const sign=await pdf.embedPng(input.signatureBytes)
    const size=sign.scaleToFit(175,68)
    page.drawImage(sign,{x:margin,y:y-size.height,width:size.width,height:size.height})
    y-=size.height+8
  }else{
    y-=30;line('_________________________________',11)
  }
  paragraph(input.signerName,11,true)
  paragraph(input.signerFunction,10)
  if(input.showReference!==false)paragraph('Dokumentreferenz: '+input.reference,9)
  pdf.setTitle(input.title)
  return Buffer.from(await pdf.save())
}
function publicRow(row: Record<string,unknown>, admin: boolean, actor: {userId:string;role:string}) {
  return {id:row.id, employeeName:row.employee_name, creatorName:row.creator_name, creatorFunction:row.creator_function, kind:row.kind, title:row.title, ...(admin?{reason:row.reason}:{}), createdAt:row.created_at, publishedAt:row.published_at, openedAt:row.first_opened_at, paperDeliveredOn:row.paper_delivered_on, acknowledgedAt:row.receipt_at, canPublish:admin&&canPublishPersonnel(row),canAcknowledge:canAcknowledgePersonnel(actor,row)}
}
export default async function personnel(request: Request, context: Context) {
  return withDeploymentContext(context, async()=>{
  const access=await requirePortalRole(['owner','admin','manager','employee'])
  if(access.response||!access.current)return access.response
  const actor=access.current, admin=canManagePersonnel(actor.role), db=getDatabase(), url=new URL(request.url)
  try {
    if(request.method==='GET'){
      const id=url.searchParams.get('id')||'', action=url.searchParams.get('action')||'list'
      if(action==='termination-notice'){
        if(!admin)return json({message:'Keine Berechtigung.'},403)
        const bytes=await renderPdf({title:TERMINATION_NOTICE_TITLE,paragraphs:TERMINATION_NOTICE_PARAGRAPHS,employeeName:'',signerName:'',signerFunction:'',issued:new Date(),reference:'',notice:true})
        return pdfResponse(bytes,'Merkblatt-zur-Kuendigung.pdf')
      }
      if(action==='list'||action==='mine'){
        const all=admin&&action==='list'
        const result=await db.pool.query('SELECT '+metadata+' FROM personnel_documents '+(all?'':'WHERE employee_user_id=$1 AND published_at IS NOT NULL ')+'ORDER BY created_at DESC LIMIT 200',all?[]:[actor.userId])
        return json({documents:result.rows.map(row=>publicRow(row,all,actor))})
      }
      if(!UUID.test(id))return json({message:'Dokument nicht gefunden.'},404)
      const row=(await db.pool.query('SELECT * FROM personnel_documents WHERE id=$1',[id])).rows[0]
      if(!canReadPersonnel(actor,row))return json({message:'Dokument nicht gefunden.'},404)
      if(action==='receipt'){
        if(!row.receipt_at||!row.receipt_signature)return json({message:'Keine Empfangsbestätigung vorhanden.'},404)
        const bytes=await renderPdf({title:'Empfangsbestätigung',paragraphs:[ACK_TEXT,'Dokument: '+row.title,'Dokument-ID: '+row.id,'SHA-256: '+row.receipt_document_sha256,'Bestätigung: '+new Date(row.receipt_at).toISOString()],employeeName:row.employee_name,signerName:row.employee_name,signerFunction:'Empfänger/in',issued:new Date(row.receipt_at),signatureBytes:signature(row.receipt_signature),reference:row.id,receipt:true})
        return pdfResponse(bytes,'Empfangsbestaetigung.pdf')
      }
      if(action!=='download')return json({message:'Unbekannte Aktion.'},400)
      const usePaper=Boolean(row.paper_copy_base64)
      const bytes=Buffer.from(usePaper?row.paper_copy_base64:row.pdf_base64,'base64')
      if(sha(bytes)!==(usePaper?row.paper_copy_sha256:row.pdf_sha256))return json({message:'Dokument konnte nicht sicher geprüft werden.'},500)
      if(row.employee_user_id===actor.userId&&row.published_at)await db.pool.query('UPDATE personnel_documents SET first_opened_at=COALESCE(first_opened_at,now()) WHERE id=$1',[id])
      return pdfResponse(bytes,row.kind==='warning'?'Abmahnung.pdf':'Kuendigung.pdf')
    }
    if(request.method!=='POST')return json({message:'Methode nicht erlaubt.'},405)
    try {verifyRequestOrigin(request)}catch{return json({message:'Ungültige Anfragequelle.'},403)}
    const action=url.searchParams.get('action')||''
    const body=await request.json().catch(()=>null)
    if(!body||typeof body!=='object')return json({message:'Ungültige Anfrage.'},400)
    if(action==='acknowledge'){
      if(!UUID.test(body.id||'')||body.accepted!==true)return json({message:'Bestätigung fehlt.'},400)
      signature(body.signature)
      const row=(await db.pool.query('SELECT * FROM personnel_documents WHERE id=$1',[body.id])).rows[0]
      if(!canAcknowledgePersonnel(actor,row))return json({message:'Keine offene Empfangsbestätigung für dieses Konto.'},409)
      const updated=await db.pool.query('UPDATE personnel_documents SET receipt_at=now(), receipt_signature=$3, receipt_document_sha256=COALESCE(paper_copy_sha256,pdf_sha256), first_opened_at=COALESCE(first_opened_at,now()) WHERE id=$1 AND employee_user_id=$2 AND published_at IS NOT NULL AND receipt_at IS NULL RETURNING id',[body.id,actor.userId,body.signature])
      if(updated.rows.length)await notifyPortalAdmins({eventKey:'personnel-receipt:'+body.id,title:'HABUN – Empfangsbestätigung',body:'Eine neue Empfangsbestätigung liegt in den Personalunterlagen vor.',url:'/?view=personnel'},actor.userId)
      return updated.rows.length?json({ok:true}):json({message:'Bereits bestätigt.'},409)
    }
    if(!admin)return json({message:'Nur Admins dürfen Personalunterlagen erstellen und versenden.'},403)
    if(action==='preview'||action==='create'){
      if(!UUID.test(body.id||'')||!SIGNER_FUNCTIONS.has(body.signerFunction)||body.authorized!==true)return json({message:'Berechtigte Unterzeichnerfunktion und Freigabe bestätigen.'},400)
      const recipientId=clean(body.employeeUserId), recipient=await accessRecord(recipientId)
      if(!recipientId||recipient?.status!=='active'||recipient.role==='pending')return json({message:'Bitte ein aktives Mitarbeiterkonto auswählen.'},409)
      const employeeName=await accountName(db,recipientId,recipient)
      const own=await accessRecord(actor.userId)
      const u=actor.user as unknown as Record<string,any>
      const creatorName=await accountName(db,actor.userId,own,clean(u.userMetadata?.fullName||u.userMetadata?.full_name||u.userMetadata?.name))
      if(!creatorName||!employeeName)return json({message:'Der Name des Admins oder Mitarbeiters fehlt im Kontoprofil.'},409)
      const content=makePersonnelText(body,employeeName)
      const signatureBytes=body.kind==='warning'&&action==='create'?signature(body.signature):undefined
      const address=normalizePersonnelAddress(body.address)
      if(body.kind==='termination'&&!validTerminationAddress(address))return json({message:'Bitte vollständige Empfängeranschrift mit Straße und Hausnummer sowie Postleitzahl und Ort eintragen; bei Auslandsanschriften zusätzlich das Land.'},400)
      const issued=new Date()
      const bytes=await renderPdf({...content,employeeName,address,signerName:creatorName,signerFunction:body.signerFunction,issued,signatureBytes,reference:body.id,showReference:body.kind!=='termination'})
      if(action==='preview')return pdfResponse(bytes,'Vorschau.pdf')
      const result=await db.pool.query('INSERT INTO personnel_documents(id,employee_user_id,employee_name,creator_user_id,creator_name,creator_function,kind,title,reason,pdf_base64,pdf_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING RETURNING id',[body.id,recipientId,employeeName,actor.userId,creatorName,body.signerFunction,body.kind,content.title,content.reason,bytes.toString('base64'),sha(bytes)])
      return result.rows.length?json({id:body.id},201):json({message:'Dieses Dokument wurde bereits gespeichert. Bitte Archiv aktualisieren.'},409)
    }
    if(!UUID.test(body.id||''))return json({message:'Dokument nicht gefunden.'},404)
    if(action==='record-paper'){
      if(!dateValid(body.deliveredOn)||new Date(body.deliveredOn+'T00:00:00Z')>new Date()||body.paperConfirmed!==true||clean(body.deliveryNote,300).length<5)return json({message:'Tatsächliche Papierzustellung, Datum und Zustellnachweis angeben.'},400)
      if(typeof body.copy!=='string'||body.copy.length>4000000)return json({message:'Bitte einen PDF-Scan bis 3 MB auswählen.'},400)
      const copy=Buffer.from(body.copy,'base64')
      if(copy.length<5||copy.length>3000000||copy.subarray(0,5).toString()!=='%PDF-')return json({message:'Ungültiger PDF-Scan.'},400)
      const result=await db.pool.query("UPDATE personnel_documents SET paper_delivered_on=$2,paper_delivery_note=$3,paper_copy_base64=$4,paper_copy_sha256=$5,paper_recorded_by=$6 WHERE id=$1 AND kind='termination' AND published_at IS NULL AND paper_delivered_on IS NULL RETURNING id",[body.id,body.deliveredOn,clean(body.deliveryNote,300),copy.toString('base64'),sha(copy),actor.userId])
      return result.rows.length?json({ok:true}):json({message:'Papierzustellung bereits erfasst oder Dokument ungültig.'},409)
    }
    if(action==='publish'){
      const row=(await db.pool.query('SELECT '+metadata+' FROM personnel_documents WHERE id=$1',[body.id])).rows[0]
      if(!canPublishPersonnel(row))return json({message:'Dokument bereits versendet oder Papierzustellung fehlt.'},409)
      const recipient=await accessRecord(row.employee_user_id)
      if(recipient?.status!=='active'||recipient.role==='pending')return json({message:'Empfängerkonto ist nicht aktiv.'},409)
      const result=await db.pool.query("UPDATE personnel_documents SET published_at=now(),published_by=$2 WHERE id=$1 AND published_at IS NULL AND (kind='warning' OR (paper_delivered_on IS NOT NULL AND paper_copy_sha256 IS NOT NULL)) RETURNING id",[body.id,actor.userId])
      if(!result.rows.length)return json({message:'Dokument bereits versendet.'},409)
      if(isProduction(context))try{await sendPushToUsers({userIds:[row.employee_user_id],eventKey:'personnel-published:'+body.id,title:'HABUN Mitarbeiterportal',body:'Ein neues Dokument ist in deinem persönlichen Postfach verfügbar.',url:'/?view=mailbox'})}catch{console.error('Personnel document push failed')}
      else await notifyPortalUsers([row.employee_user_id],{eventKey:'personnel-published:'+body.id,title:'HABUN Mitarbeiterportal',body:'Ein neues Dokument ist in deinem persönlichen Postfach verfügbar.',url:'/?view=mailbox'})
      return json({ok:true})
    }
    return json({message:'Unbekannte Aktion.'},400)
  } catch(error) {
    if(error instanceof TypeError)return json({message:error.message},400)
    console.error('Personnel document operation failed',request.method,url.searchParams.get('action'))
    return json({message:'Personalunterlagen sind momentan nicht verfügbar.'},500)
  }
  })
}
export const config: Config = {path:'/api/personnel-documents'}
