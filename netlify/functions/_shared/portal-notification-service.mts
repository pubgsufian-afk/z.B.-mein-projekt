import { getStore } from '@netlify/blobs'
import { sendPushToUsers } from './push-core.mts'
import { deploymentContext, persistPortalNotice } from './portal-notification-storage.mts'
import { isActiveAdmin, notificationUrl } from './portal-notification-policy.mjs'

type Notice={eventKey:string;title:string;body:string;url:string}
type Account={role?:string;status?:string;email?:string}
export async function activeAdministrationIds(exclude=''){
  const store=getStore({name:'portal-access',consistency:'strong'})
  const result=await store.list({prefix:'access/'})
  const ids=await Promise.all(result.blobs.map(async blob=>{
    const record=await store.get(blob.key,{type:'json'}) as Account|null
    return isActiveAdmin(record)?blob.key.slice('access/'.length):''
  }))
  // The main owner can have no access-directory row. Only a configured owner
  // address on a registered device may supply this fallback, never its cached role alone.
  const ownerEmails=new Set(String(Netlify.env.get('PORTAL_OWNER_EMAILS')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean))
  if(ownerEmails.size){
    const devices=getStore({name:'portal-push-devices-v1',consistency:'strong'})
    const rows=await devices.list({prefix:'devices/'})
    for(const blob of rows.blobs){
      const device=await devices.get(blob.key,{type:'json'}) as {userId?:string;email?:string}|null
      if(!device?.userId||!ownerEmails.has(String(device.email||'').toLowerCase()))continue
      const record=await store.get('access/'+device.userId,{type:'json'}) as Account|null
      if(!record||record.status==='active')ids.push(device.userId)
    }
  }
  return [...new Set(ids.filter(id=>id&&id!==exclude))]
}
export async function notifyPortalUsers(userIds:string[],notice:Notice){
  if(!deploymentContext())return
  try{
    const ids=[...new Set(userIds.map(x=>String(x||'').trim()).filter(Boolean))]
    if(!ids.length)return
    const input={...notice,url:notificationUrl(notice.url),userIds:ids}
    // The persistent inbox does not depend on device subscriptions.
    await persistPortalNotice(input)
    if(deploymentContext()==='production')await sendPushToUsers(input)
  }catch{console.error('Portal notification failed',notice.eventKey.split(':')[0])}
}
export async function notifyPortalAdmins(notice:Notice,exclude=''){
  if(!deploymentContext())return
  try{await notifyPortalUsers(await activeAdministrationIds(exclude),notice)}
  catch{console.error('Administration notification failed',notice.eventKey.split(':')[0])}
}
