const allowedViews=new Set(['attendance','schedule','mailbox','time-off','my-hours','daily-reports','reports','corrections','employees','notifications','overview','personnel'])
export function notificationUrl(value){
  if(value==='/')return '/'
  const m=/^\/\?view=([a-z-]+)$/.exec(String(value||''))
  return m&&allowedViews.has(m[1])?m[0]:'/?view=notifications'
}
export function administrationRole(role){return role==='owner'||role==='admin'}
export function canReadMessage(actor,row){
  return Boolean(actor?.userId&&row&&(row.sender_user_id===actor.userId||row.recipient_user_id===actor.userId||(row.to_administration&&administrationRole(actor.role))))
}
export function recipientForMessage(actor,requested,access){
  if(!actor?.userId||actor.role==='pending')throw new TypeError('Keine Berechtigung.')
  if(!administrationRole(actor.role))return {recipientUserId:null,toAdministration:true}
  const id=typeof requested==='string'?requested.trim():''
  if(!id||access?.status!=='active'||!['owner','admin','manager','employee'].includes(access.role))throw new TypeError('Bitte ein aktives Empfängerkonto auswählen.')
  return {recipientUserId:id,toAdministration:false}
}
export function isActiveAdmin(access){
  return access?.status==='active'&&administrationRole(access.role)
}
export function reminderMessage(kind,minutes,clock){
  if(kind==='start')return Number(minutes)===30?'Dein Dienst beginnt um '+clock+' Uhr (in 30 Minuten). Bitte bereite dich vor.':'Dein Dienst beginnt um '+clock+' Uhr (in 5 Minuten). Bitte öffne die Stempeluhr und stemple zum tatsächlichen Dienstbeginn ein.'
  if(Number(minutes)===0)return 'Dein geplanter Dienst endet jetzt. Bitte beende die Stempeluhr, sobald deine Arbeit tatsächlich beendet ist.'
  return 'Dein geplanter Dienst endet um '+clock+' Uhr (in '+minutes+' Minuten). Bitte denke an die Dienstübergabe und das Ausstempeln zum tatsächlichen Arbeitsende.'
}
