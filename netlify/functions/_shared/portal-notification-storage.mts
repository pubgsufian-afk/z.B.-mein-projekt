import { getDatabase } from '@netlify/database'
import { notificationUrl } from './portal-notification-policy.mjs'
export function deploymentContext(){
  return typeof Netlify==='undefined'?'':String(Netlify.context?.deploy?.context||'')
}
export async function persistPortalNotice(input:{userIds:string[];eventKey:string;title:string;body:string;url?:string}){
  const ids=[...new Set(input.userIds.map(x=>String(x||'').trim()).filter(Boolean))]
  if(!ids.length)return
  await getDatabase().pool.query(
    'INSERT INTO portal_notifications(recipient_user_id,event_key,title,body,url) SELECT unnest($1::text[]),$2,$3,$4,$5 ON CONFLICT(recipient_user_id,event_key) DO NOTHING',
    [ids,input.eventKey.slice(0,240),input.title.slice(0,120),input.body.slice(0,500),notificationUrl(input.url)])
}
