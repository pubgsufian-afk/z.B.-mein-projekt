import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { sendPushToUsers } from './_shared/push-core.mts'

// A server-side minute timer works even when the portal is closed. Timezone
// conversion happens in PostgreSQL (including German summer/winter time).
// The existing claim table prevents duplicate deliveries between invocations.
export default async function scheduleStartReminders(_request: Request, context: Context) {
  if(context.deploy?.context!=='production')return
  const db=getDatabase()
  const due=await db.pool.query(
    "WITH scheduled AS ("+
    " SELECT s.id,s.employee_user_id,s.start_time,((s.shift_date+s.start_time) AT TIME ZONE 'Europe/Berlin') AS starts"+
    " FROM schedule_shifts s JOIN schedule_employees e ON e.user_id=s.employee_user_id AND e.status='active'"+
    " WHERE s.status='published' AND s.shift_date BETWEEN (now() AT TIME ZONE 'Europe/Berlin')::date AND (now() AT TIME ZONE 'Europe/Berlin')::date+1"+
    "), due AS (SELECT s.*,m.minutes FROM scheduled s CROSS JOIN (VALUES (30),(5)) m(minutes)"+
    " WHERE s.starts>now() AND s.starts-m.minutes*interval '1 minute'<=now() AND s.starts-m.minutes*interval '1 minute'>now()-interval '2 minutes'"+
    " AND NOT EXISTS (SELECT 1 FROM attendance_events a WHERE a.user_id=s.employee_user_id AND a.schedule_id=s.id AND a.action='clock-in' AND a.client_occurred_at>=s.starts-interval '2 hours'))"+
    " SELECT DISTINCT ON(employee_user_id,starts,minutes) id,employee_user_id,starts,minutes,to_char(start_time,'HH24:MI') AS clock FROM due ORDER BY employee_user_id,starts,minutes,id"
  )
  const store=getStore({name:'portal-access',consistency:'strong'})
  for(const row of due.rows){
    try{
      const current=await store.get('access/'+row.employee_user_id,{type:'json'}) as {status?:string;role?:string}|null
      if(current?.status!=='active'||current.role==='pending')continue
      const instant=new Date(row.starts).toISOString()
      const key='start-v2:'+row.employee_user_id+'@'+instant+':'+row.minutes
      const claim=await db.pool.query("INSERT INTO schedule_push_reminders(reminder_key,shift_id,scheduled_start,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING reminder_key",[key,row.id,instant,row.employee_user_id])
      if(!claim.rows.length)continue
      // Recheck the assignment and start time just before dispatching.
      const currentShift=await db.pool.query("SELECT id FROM schedule_shifts WHERE id=$1 AND employee_user_id=$2 AND status='published' AND ((shift_date+start_time) AT TIME ZONE 'Europe/Berlin')=$3::timestamptz AND ((shift_date+start_time) AT TIME ZONE 'Europe/Berlin')>now()",[row.id,row.employee_user_id,instant])
      if(!currentShift.rows.length){await db.pool.query('DELETE FROM schedule_push_reminders WHERE reminder_key=$1 AND status=$2',[key,'claimed']);continue}
      const message=Number(row.minutes)===30?'Dein Dienst beginnt um '+row.clock+' Uhr (in 30 Minuten). Bitte bereite dich vor.':'Dein Dienst beginnt um '+row.clock+' Uhr (in 5 Minuten). Bitte öffne die Stempeluhr und stemple zum tatsächlichen Dienstbeginn ein.'
      const result=await sendPushToUsers({userIds:[row.employee_user_id],title:'HABUN – Diensterinnerung',body:message,url:'/?view=attendance'})
      if(!result.targeted)await db.pool.query('DELETE FROM schedule_push_reminders WHERE reminder_key=$1 AND status=$2',[key,'claimed'])
      else await db.pool.query("UPDATE schedule_push_reminders SET status='processed',processed_at=now() WHERE reminder_key=$1",[key])
    }catch{console.error('Schedule reminder processing failed')}
  }
}
export const config: Config={schedule:'* * * * *'}
