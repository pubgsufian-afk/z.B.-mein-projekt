import { withDeploymentContext } from './_shared/portal-notification-storage.mts'
import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { getStore } from '@netlify/blobs'
import { sendPushToUsers } from './_shared/push-core.mts'
import { reminderMessage } from './_shared/portal-notification-policy.mjs'

// Minute timer, also when the portal is closed. German local time and overnight shifts.
// An end reminder is sent only for a still-open attendance session for that shift.
export default async function scheduleStartReminders(_request:Request,context:Context){
  return withDeploymentContext(context, async()=>{
  if(context.deploy?.context!=='production')return
  const db=getDatabase()
  const due=await db.pool.query(
    "WITH scheduled AS ("+
    " SELECT s.id,s.employee_user_id,s.start_time,s.end_time,((s.shift_date+s.start_time) AT TIME ZONE 'Europe/Berlin') AS starts,"+
    " ((s.shift_date+s.end_time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE 'Europe/Berlin') AS ends"+
    " FROM schedule_shifts s JOIN schedule_employees e ON e.user_id=s.employee_user_id AND e.status='active'"+
    " WHERE s.status='published' AND s.shift_date BETWEEN (now() AT TIME ZONE 'Europe/Berlin')::date-1 AND (now() AT TIME ZONE 'Europe/Berlin')::date+1"+
    "), events AS ("+
    " SELECT s.*,k.kind,m.minutes,CASE WHEN k.kind='start' THEN s.starts ELSE s.ends END AS target,CASE WHEN k.kind='start' THEN s.start_time ELSE s.end_time END AS clock"+
    " FROM scheduled s CROSS JOIN (VALUES ('start'),('end')) k(kind) CROSS JOIN (VALUES (30),(5),(0)) m(minutes)"+
    " WHERE (k.kind='end' OR m.minutes>0)"+
    "), due AS ("+
    " SELECT s.* FROM events s WHERE s.target-s.minutes*interval '1 minute'<=now() AND s.target-s.minutes*interval '1 minute'>now()-interval '2 minutes'"+
    " AND ((s.kind='start' AND s.target>now() AND NOT EXISTS (SELECT 1 FROM attendance_events a WHERE a.user_id=s.employee_user_id AND a.schedule_id=s.id AND a.action='clock-in' AND a.client_occurred_at>=s.starts-interval '2 hours'))"+
    " OR (s.kind='end' AND (SELECT a.action FROM attendance_events a WHERE a.user_id=s.employee_user_id AND a.schedule_id=s.id AND a.client_occurred_at>=s.starts-interval '2 hours' ORDER BY a.client_occurred_at DESC,a.server_occurred_at DESC,a.id DESC LIMIT 1) IN ('clock-in','break-start','break-end')))"+
    ") SELECT DISTINCT ON(employee_user_id,target,kind,minutes) id,employee_user_id,target,kind,minutes,to_char(clock,'HH24:MI') AS clock FROM due ORDER BY employee_user_id,target,kind,minutes,id"
  )
  const store=getStore({name:'portal-access',consistency:'strong'})
  for(const row of due.rows){
    try{
      const current=await store.get('access/'+row.employee_user_id,{type:'json'}) as {status?:string;role?:string}|null
      if(current?.status!=='active'||current.role==='pending')continue
      const instant=new Date(row.target).toISOString()
      const key=row.kind+'-v2:'+row.employee_user_id+'@'+instant+':'+row.minutes
      const claim=await db.pool.query("INSERT INTO schedule_push_reminders(reminder_key,shift_id,scheduled_start,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING reminder_key",[key,row.id,instant,row.employee_user_id])
      if(!claim.rows.length)continue
      // Recheck actual published assignment, time, and open attendance just before delivery.
      const currentShift=await db.pool.query(
        "SELECT s.id FROM schedule_shifts s WHERE s.id=$1 AND s.employee_user_id=$2 AND s.status='published'"+
        " AND (CASE WHEN $4='start' THEN ((s.shift_date+s.start_time) AT TIME ZONE 'Europe/Berlin') ELSE ((s.shift_date+s.end_time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE 'Europe/Berlin') END)=$3::timestamptz"+
        " AND (($4='start' AND $3::timestamptz>now() AND NOT EXISTS(SELECT 1 FROM attendance_events a WHERE a.user_id=s.employee_user_id AND a.schedule_id=s.id AND a.action='clock-in' AND a.client_occurred_at>=((s.shift_date+s.start_time) AT TIME ZONE 'Europe/Berlin')-interval '2 hours'))"+
        " OR ($4='end' AND (SELECT a.action FROM attendance_events a WHERE a.user_id=s.employee_user_id AND a.schedule_id=s.id AND a.client_occurred_at>=((s.shift_date+s.start_time) AT TIME ZONE 'Europe/Berlin')-interval '2 hours' ORDER BY a.client_occurred_at DESC,a.server_occurred_at DESC,a.id DESC LIMIT 1) IN ('clock-in','break-start','break-end')))",
        [row.id,row.employee_user_id,instant,row.kind])
      if(!currentShift.rows.length){await db.pool.query('DELETE FROM schedule_push_reminders WHERE reminder_key=$1 AND status=$2',[key,'claimed']);continue}
      const message=reminderMessage(row.kind,row.minutes,row.clock)
      // No automatic clock-in or clock-out: only a reminder to record actual work.
      const result=await sendPushToUsers({userIds:[row.employee_user_id],eventKey:key,title:'HABUN – Diensterinnerung',body:message,url:'/?view=attendance'})
      if(!result.targeted)await db.pool.query('DELETE FROM schedule_push_reminders WHERE reminder_key=$1 AND status=$2',[key,'claimed'])
      else await db.pool.query("UPDATE schedule_push_reminders SET status='processed',processed_at=now() WHERE reminder_key=$1",[key])
    }catch{console.error('Schedule reminder processing failed')}
  }
  })
}
export const config:Config={schedule:'* * * * *'}
