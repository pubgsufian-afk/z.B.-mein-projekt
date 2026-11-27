import assert from 'node:assert/strict'
import { build } from 'esbuild'
const state={notices:[],push:[],stores:new Map()}
globalThis.__notificationRuntime=state
globalThis.Netlify={env:{get:()=>''}}
function store(name){if(!state.stores.has(name))state.stores.set(name,new Map());return state.stores.get(name)}
for(const [id,role,status] of [['admin','admin','active'],['owner','owner','active'],['staff','employee','active'],['other','employee','active'],['old-admin','admin','inactive'],['manager','manager','active']]){
 store('portal-access').set('access/'+id,{role,status})
 store('portal-push-devices-v1').set('devices/'+id,{tokenHash:id,endpoint:'https://test.invalid/'+id,userId:id,email:'',role,updatedAt:'',latestMessage:null})
}
globalThis.fetch=async input=>{
 const endpoint=String(input);assert.ok(endpoint.startsWith('https://test.invalid/'));state.push.push(endpoint.split('/').at(-1));return new Response(null,{status:201})
}
const mocks={
 '@netlify/database':"export function getDatabase(){return {pool:{query:async(sql,params)=>{globalThis.__notificationRuntime.notices.push(params);return {rows:[]}}}}}",
 '@netlify/blobs':"export function getStore({name}){const data=globalThis.__notificationRuntime.stores.get(name)||new Map();globalThis.__notificationRuntime.stores.set(name,data);return {get:async k=>data.get(k)||null,setJSON:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))})}}",
}
const bundled=await build({stdin:{contents:"export {withDeploymentContext,deploymentContext} from './netlify/functions/_shared/portal-notification-storage.mts'; export {notifyPortalAdmins,notifyPortalUsers} from './netlify/functions/_shared/portal-notification-service.mts'; export {sendPushToUsers} from './netlify/functions/_shared/push-core.mts'",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'mock',setup(c){c.onResolve({filter:/^@netlify\/(database|blobs)$/},a=>({path:a.path,namespace:'mock'}));c.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}))}}]})
const {withDeploymentContext,deploymentContext,notifyPortalAdmins,notifyPortalUsers,sendPushToUsers}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const event={eventKey:'test:1',title:'HABUN',body:'Neue Mitteilung',url:'/?view=mailbox'}
assert.equal(deploymentContext(),'')
await notifyPortalUsers(['staff'],event)
await sendPushToUsers({...event,userIds:['staff']})
assert.equal(state.push.length,0);assert.equal(state.notices.length,0)
await withDeploymentContext({deploy:{context:'deploy-preview'}},()=>notifyPortalAdmins(event,'staff'))
assert.deepEqual(state.notices[0][0].sort(),['admin','owner']);assert.equal(state.push.length,0)
await withDeploymentContext({deploy:{context:'production'}},()=>notifyPortalAdmins({...event,eventKey:'test:2'},'staff'))
assert.deepEqual(state.push.sort(),['admin','owner']);assert.equal(state.notices.length,2)
await withDeploymentContext({deploy:{context:'production'}},()=>notifyPortalUsers(['staff','staff'],{...event,eventKey:'test:3'}))
assert.deepEqual(state.notices[2][0],['staff']);assert.equal(state.push.at(-1),'staff')
await Promise.all([
 withDeploymentContext({deploy:{context:'production'}},async()=>{await Promise.resolve();assert.equal(deploymentContext(),'production')}),
 withDeploymentContext({deploy:{context:'deploy-preview'}},async()=>{await Promise.resolve();assert.equal(deploymentContext(),'deploy-preview')}),
])
assert.equal(deploymentContext(),'')
console.log('Real notification sender: context isolation, target-only delivery and preview safety verified with mocked external services')
