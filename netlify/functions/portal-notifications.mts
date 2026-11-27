import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { verifyRequestOrigin } from '@netlify/identity'
import { requirePortalRole } from './_shared/portal-role.mts'
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers})
export default async function notifications(request:Request){
  const access=await requirePortalRole(['owner','admin','manager','employee'])
  if(access.response||!access.current)return access.response
  const id=access.current.userId,db=getDatabase()
  try{
    if(request.method==='GET'){
      const [rows,count]=await Promise.all([
        db.pool.query('SELECT event_key AS id,title,body,url,created_at AS "createdAt",read_at AS "readAt" FROM portal_notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 200',[id]),
        db.pool.query('SELECT count(*)::int AS unread FROM portal_notifications WHERE recipient_user_id=$1 AND read_at IS NULL',[id])
      ])
      return json({notifications:rows.rows,unreadCount:Number(count.rows[0]?.unread||0)})
    }
    if(request.method!=='POST')return json({message:'Methode nicht erlaubt.'},405)
    try{verifyRequestOrigin(request)}catch{return json({message:'Ungültige Anfragequelle.'},403)}
    const body=await request.json().catch(()=>null)
    if(body?.action==='read-all'){
      await db.pool.query('UPDATE portal_notifications SET read_at=COALESCE(read_at,now()) WHERE recipient_user_id=$1 AND read_at IS NULL',[id])
    }else if(body?.action==='read'&&typeof body.id==='string'&&body.id.length<=240){
      await db.pool.query('UPDATE portal_notifications SET read_at=COALESCE(read_at,now()) WHERE recipient_user_id=$1 AND event_key=$2',[id,body.id])
    }else return json({message:'Ungültige Aktion.'},400)
    return json({ok:true})
  }catch{console.error('Portal notification read failed');return json({message:'Benachrichtigungen sind momentan nicht verfügbar.'},503)}
}
export const config:Config={path:'/api/portal-notifications'}
