import { withDeploymentContext } from './_shared/portal-notification-storage.mts'
import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { verifyRequestOrigin } from '@netlify/identity'
import { createHash } from 'node:crypto'
import { requirePortalRole } from './_shared/portal-role.mts'
import { administrationRole,canReadMessage,recipientForMessage } from './_shared/portal-notification-policy.mjs'
import { notifyPortalAdmins,notifyPortalUsers } from './_shared/portal-notification-service.mts'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers})
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const select='id,sender_user_id,sender_name,recipient_user_id,to_administration,subject,body,attachment_name,attachment_type,created_at'
const MAX_BYTES=3*1024*1024
function parseAttachment(value:any){
  if(!value)return null
  if(typeof value.data!=='string'||value.data.length>Math.ceil(MAX_BYTES/3)*4+4||typeof value.name!=='string')throw new TypeError('Datei ist zu groß oder ungültig (maximal 3 MB).')
  const bytes=Buffer.from(value.data,'base64')
  if(bytes.length<5||bytes.length>MAX_BYTES)throw new TypeError('Datei ist zu groß oder ungültig.')
  const type=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'image/png':bytes.subarray(0,3).toString('hex')==='ffd8ff'?'image/jpeg':''
  if(!type)throw new TypeError('Bitte PDF, JPG oder PNG auswählen.')
  const ext=type==='application/pdf'?'.pdf':type==='image/png'?'.png':'.jpg'
  const name=(value.name.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/\.[^.]+$/,'').slice(0,100)||'Anhang')+ext
  return {name,type,base64:bytes.toString('base64'),sha256:hash(bytes)}
}
export default async function messages(request:Request, context?: Context) {
  return withDeploymentContext(context, async()=>{
  const access=await requirePortalRole(['owner','admin','manager','employee'])
  if(access.response||!access.current)return access.response
  const actor=access.current,admin=administrationRole(actor.role),db=getDatabase(),url=new URL(request.url)
  try{
    if(request.method==='GET'){
      const action=url.searchParams.get('action')||'list'
      if(action==='list'){
        const rows=await db.pool.query('SELECT '+select+' FROM portal_mail_messages WHERE sender_user_id=$1 OR recipient_user_id=$1 OR ($2::boolean AND to_administration) ORDER BY created_at DESC LIMIT 200',[actor.userId,admin])
        return json({messages:rows.rows.map(r=>({id:r.id,senderName:r.sender_name,senderUserId:r.sender_user_id,recipientUserId:r.recipient_user_id,toAdministration:r.to_administration,subject:r.subject,body:r.body,attachmentName:r.attachment_name,attachmentType:r.attachment_type,createdAt:r.created_at,outgoing:r.sender_user_id===actor.userId}))})
      }
      const id=url.searchParams.get('id')||''
      if(action!=='download'||!uuid.test(id))return json({message:'Anhang nicht gefunden.'},404)
      const row=(await db.pool.query('SELECT * FROM portal_mail_messages WHERE id=$1',[id])).rows[0]
      if(!canReadMessage(actor,row)||!row.attachment_base64)return json({message:'Anhang nicht gefunden.'},404)
      const bytes=Buffer.from(row.attachment_base64,'base64')
      if(hash(bytes)!==row.attachment_sha256)return json({message:'Datei konnte nicht sicher geprüft werden.'},500)
      return new Response(bytes,{headers:{...headers,'Content-Type':row.attachment_type,'Content-Disposition':'attachment; filename="'+String(row.attachment_name).replace(/[^a-zA-Z0-9._ -]/g,'_')+'"','Content-Security-Policy':'sandbox'}})
    }
    if(request.method!=='POST')return json({message:'Methode nicht erlaubt.'},405)
    try{verifyRequestOrigin(request)}catch{return json({message:'Ungültige Anfragequelle.'},403)}
    const body=await request.json().catch(()=>null)
    if(!body||typeof body.id!=='string'||!uuid.test(body.id))return json({message:'Ungültige Nachricht.'},400)
    const subject=typeof body.subject==='string'?body.subject.trim():''
    const text=typeof body.body==='string'?body.body.trim():''
    if(!subject||subject.length>160||text.length>6000||(!text&&!body.attachment))return json({message:'Betreff und Nachricht oder Anhang sind erforderlich.'},400)
    const store=getStore({name:'portal-access',consistency:'strong'})
    const requested=admin&&typeof body.recipientUserId==='string'?body.recipientUserId.trim():''
    const target=requested?await store.get('access/'+requested,{type:'json'}):null
    const destination=recipientForMessage(actor,requested,target)
    const own=await store.get('access/'+actor.userId,{type:'json'}) as {fullName?:string}|null
    const meta=(actor.user as any).userMetadata||{}
    const name=String(own?.fullName||meta.fullName||meta.full_name||meta.name||'').trim().slice(0,160)
    if(!name)return json({message:'Im Benutzerprofil fehlt der Name.'},409)
    const attachment=parseAttachment(body.attachment)
    const result=await db.pool.query('INSERT INTO portal_mail_messages(id,sender_user_id,sender_name,recipient_user_id,to_administration,subject,body,attachment_name,attachment_type,attachment_base64,attachment_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING RETURNING id',[body.id,actor.userId,name,destination.recipientUserId,destination.toAdministration,subject,text,attachment?.name||null,attachment?.type||null,attachment?.base64||null,attachment?.sha256||null])
    if(!result.rows.length)return json({message:'Nachricht wurde bereits gespeichert. Bitte Postfach aktualisieren.'},409)
    const notice={eventKey:'mail:'+body.id,title:'HABUN – Neue Nachricht',body:'Eine neue Nachricht '+(attachment?'mit Anhang ':'')+'ist im geschützten Postfach verfügbar.',url:'/?view=mailbox'}
    if(destination.toAdministration)await notifyPortalAdmins(notice,actor.userId)
    else await notifyPortalUsers([destination.recipientUserId!],notice)
    return json({ok:true,id:body.id},201)
  }catch(error){if(error instanceof TypeError)return json({message:error.message},400);console.error('Portal messages operation failed');return json({message:'Nachricht konnte nicht verarbeitet werden.'},500)}
  })
}
export const config:Config={path:'/api/portal-messages'}
