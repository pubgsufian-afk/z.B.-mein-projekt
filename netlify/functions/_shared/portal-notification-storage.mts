import { getDatabase } from '@netlify/database'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@netlify/functions'
import { notificationUrl } from './portal-notification-policy.mjs'
const runtimeContext = new AsyncLocalStorage<string>()
export function withDeploymentContext<T>(context: Pick<Context,'deploy'> | undefined, fn:()=>T):T {
  return runtimeContext.run(String(context?.deploy?.context || ''),fn)
}
export function deploymentContext(){
  return runtimeContext.getStore() || ''
}
export async function persistPortalNotice(input:{userIds:string[];eventKey:string;title:string;body:string;url?:string}){
  const ids=[...new Set(input.userIds.map(x=>String(x||'').trim()).filter(Boolean))]
  if(!ids.length)return
  await getDatabase().pool.query(
    'INSERT INTO portal_notifications(recipient_user_id,event_key,title,body,url) SELECT unnest($1::text[]),$2,$3,$4,$5 ON CONFLICT(recipient_user_id,event_key) DO NOTHING',
    [ids,input.eventKey.slice(0,240),input.title.slice(0,120),input.body.slice(0,500),notificationUrl(input.url)])
}
