import assert from 'node:assert/strict'
import { adjacentDay, berlinDay, groupLiveAttendance } from '../frontend/src/live-attendance-overview.mjs'
const ev=(userId,id,action,t,extra={})=>({userId,id,action,clientOccurredAt:t,employeeName:userId==='a'?'Person A':'Person B',eventDate:berlinDay(t),...extra})
const day='2026-11-28', now=new Date('2026-11-28T10:00:00+01:00')
const data=[
 ev('a','1','clock-in','2026-11-28T06:00:00+01:00'),
 ev('a','2','break-start','2026-11-28T08:00:00+01:00'),
 ev('b','6','clock-in','2026-11-28T07:00:00+01:00'),
 ev('a','3','break-end','2026-11-28T08:20:00+01:00'),
 ev('a','4','break-start','2026-11-28T09:00:00+01:00'),
 ev('b','7','clock-out','2026-11-28T09:00:00+01:00',{pauseMinutesAdjustment:15}),
]
const [a,b]=groupLiveAttendance([...data].reverse(),day,now)
assert.equal(a.status,'paused')
assert.equal(a.sessions[0].pauseMinutes,80)
assert.equal(a.sessions[0].runningPauseMinutes,60)
assert.equal(a.sessions[0].netMinutes,160)
assert.equal(b.sessions[0].pauseMinutes,15)
assert.equal(b.sessions[0].netMinutes,105)
const done=groupLiveAttendance([...data,ev('a','5','break-end','2026-11-28T09:30:00+01:00'),ev('a','8','clock-out','2026-11-28T10:00:00+01:00')],day,now)[0]
assert.equal(done.sessions[0].pauseMinutes,50)
assert.equal(done.sessions[0].netMinutes,190)
assert.equal(done.status,'completed')
const missing=groupLiveAttendance([ev('a','x','break-end','2026-11-28T09:30:00+01:00')],day,now)[0]
assert.equal(missing.status,'check')
assert.equal(missing.sessions[0].netMinutes,null)
const overnight=groupLiveAttendance([ev('a','n1','clock-in','2026-11-27T22:00:00+01:00'),ev('a','n2','break-start','2026-11-28T01:00:00+01:00'),ev('a','n3','break-end','2026-11-28T01:30:00+01:00'),ev('a','n4','clock-out','2026-11-28T06:00:00+01:00')],day,now)[0]
assert.equal(overnight.sessions[0].netMinutes,450)
assert.equal(overnight.sessions[0].pauseMinutes,30)
const multiple=groupLiveAttendance([ev('a','m1','clock-in','2026-11-28T06:00:00+01:00'),ev('a','m2','clock-out','2026-11-28T07:00:00+01:00'),ev('a','m3','clock-in','2026-11-28T08:00:00+01:00')],day,now)[0]
assert.equal(multiple.sessions.length,2)
assert.equal(multiple.status,'working')
assert.equal(multiple.sessions[1].netMinutes,120)
const historical=groupLiveAttendance([ev('a','h1','clock-in','2026-11-27T06:00:00+01:00')],'2026-11-27',now)[0]
assert.equal(historical.status,'check')
assert.equal(historical.sessions[0].netMinutes,null)
assert.equal(adjacentDay('2026-12-01',-1),'2026-11-30')
assert.equal(berlinDay('2026-11-27T23:30:00Z'),day)
assert.equal(groupLiveAttendance([data[0],data[0]],day,now)[0].sessions[0].events.length,1)
console.log('Live overview grouping, pause calculation and incomplete bookings passed')
