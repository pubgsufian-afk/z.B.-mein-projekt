import assert from 'node:assert/strict'
import { administrationRole,canReadMessage,recipientForMessage,isActiveAdmin,notificationUrl,reminderMessage } from '../netlify/functions/_shared/portal-notification-policy.mjs'
const admin={userId:'admin-a',role:'admin'},owner={userId:'owner',role:'owner'},e1={userId:'staff-1',role:'employee'},e2={userId:'staff-2',role:'employee'},manager={userId:'manager',role:'manager'}
const incoming={sender_user_id:e1.userId,recipient_user_id:null,to_administration:true}
const outgoing={sender_user_id:admin.userId,recipient_user_id:e1.userId,to_administration:false}
for(const a of [e1,admin,owner])assert.equal(canReadMessage(a,incoming),true)
for(const a of [e2,manager,null])assert.equal(canReadMessage(a,incoming),false)
for(const a of [e1,admin])assert.equal(canReadMessage(a,outgoing),true)
for(const a of [e2,manager,owner])assert.equal(canReadMessage(a,outgoing),false)
assert.deepEqual(recipientForMessage(e1,e2.userId,{role:'employee',status:'active'}),{recipientUserId:null,toAdministration:true})
assert.deepEqual(recipientForMessage(admin,e1.userId,{role:'employee',status:'active'}),{recipientUserId:e1.userId,toAdministration:false})
assert.throws(()=>recipientForMessage(admin,e1.userId,{role:'employee',status:'inactive'}))
assert.throws(()=>recipientForMessage(admin,e1.userId,{role:'pending',status:'active'}))
assert.equal(administrationRole('manager'),false)
assert.equal(isActiveAdmin({role:'admin',status:'inactive'}),false)
assert.equal(isActiveAdmin({role:'owner',status:'active'}),true)
assert.equal(notificationUrl('https://external.invalid'), '/?view=notifications')
assert.equal(notificationUrl('/?view=personnel'), '/?view=personnel')
assert.equal(notificationUrl('/?view=attendance'), '/?view=attendance')
for(const offset of [30,5]){assert.match(reminderMessage('start',offset,'06:00'),new RegExp(offset+' Minuten'));assert.match(reminderMessage('end',offset,'14:30'),new RegExp(offset+' Minuten'));assert.match(reminderMessage('end',offset,'14:30'),/tatsächlichen Arbeitsende/)}
assert.match(reminderMessage('end',0,'14:30'),/endet jetzt/)
assert.match(reminderMessage('end',-25,'14:30'),/seit 25 Minuten/)
assert.match(reminderMessage('end',-25,'14:30'),/nach 30 Minuten automatisch/)
console.log('Notification recipient isolation and reminder policy passed')
