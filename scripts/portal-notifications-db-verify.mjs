import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
// Run only in a disposable PostgreSQL instance; extract the production SQL.
const source=await readFile('netlify/functions/schedule-start-reminders.mts','utf8')
function queryAfter(anchor){
 const start=source.indexOf(anchor)
 assert.ok(start>=0)
 const part=source.slice(start+anchor.length).split(/\n\s*(?:\)|\[row\.id,)/)[0]
 const pieces=[...part.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m=>JSON.parse(m[0]))
 assert.ok(pieces.length>1)
 return pieces.join('')
}
const due=queryAfter('const due=await db.pool.query(')
const recheck=queryAfter('const currentShift=await db.pool.query(')
function timed(q,instant){return q.replaceAll('now()',instant)}
let sql=await readFile('scripts/portal-notifications-db-fixtures.sql','utf8')
for(const [name,time] of [['start_due','05:30:30'],['five_due','14:25:30'],['zero_due','14:30:30'],['post_due','14:55:30']]){
 sql+="\nCREATE TEMP VIEW "+name+" AS "+timed(due,"TIMESTAMPTZ '2026-11-28 "+time+"+01'")+";\n"
}
sql+="PREPARE reminder_recheck(text,text,timestamptz,text) AS "+timed(recheck,"TIMESTAMPTZ '2026-11-28 14:25:30+01'")+";\n"
sql+="EXECUTE reminder_recheck('end','end-user','2026-11-28 14:30:00+01','end');\n"
const worker=await readFile('netlify/functions/attendance-auto-checkout.mts','utf8')
const scan=worker.match(/const result = await database\.pool\.query\(\s*`([\s\S]*?)`,\s*\[userId, now\.toISOString\(\), recentOnly\]/)?.[1]
assert.ok(scan,'production due checkout SQL not found')
for(const [name,time] of [['checkout_before','14:59:59'],['checkout_due','15:00:00']]){
 const query=scan.replaceAll('$1','NULL').replaceAll('$2',`TIMESTAMPTZ '2026-11-28 ${time}+01'`).replaceAll('$3','TRUE')
 sql+='\nCREATE TEMP VIEW '+name+' AS '+query+';\n'
}
sql+=await readFile('scripts/portal-notifications-db-assertions.sql','utf8')
console.log(sql)
