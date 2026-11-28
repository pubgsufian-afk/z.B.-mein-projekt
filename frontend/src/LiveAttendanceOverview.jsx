import { useEffect, useMemo, useState } from 'react'
import { adjacentDay, berlinDay, groupLiveAttendance } from './live-attendance-overview.mjs'
import './live-attendance-overview.css'
import { useDataRefresh } from './use-data-refresh.js'
import { dedupeInflightJson } from './read-cache.js'

const clock = new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const fullClock = new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
const time = (stamp,day) => stamp === null || !Number.isFinite(stamp) ? '–' : berlinDay(stamp)===day ? clock.format(stamp) : fullClock.format(stamp)
const duration = n => n === null || n === undefined ? '–' : n+' Min.'
const names = {working:'Arbeitet',paused:'In Pause',completed:'Beendet',check:'Buchungen prüfen'}
const labels = {'clock-in':'Arbeitsbeginn','clock-out':'Arbeitsende','break-start':'Pause begonnen','break-end':'Pause beendet'}
const locations = {inside:'Im Bereich',outside:'Außerhalb',unavailable:'Nicht verfügbar'}
export default function LiveAttendanceOverview({loadJson}){
  const [now,setNow]=useState(()=>new Date())
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),15000);return()=>window.clearInterval(timer)},[])
  const today=berlinDay(now), [day,setDay]=useState(today), [query,setQuery]=useState(''), [filter,setFilter]=useState('all')
  const [revision,setRevision]=useState(0), [result,setResult]=useState(null), [error,setError]=useState(null)
  useDataRefresh(()=>setRevision(r=>r+1))
  useEffect(()=>{
    let cancelled=false, running=false
    const load=async()=>{
      if(running)return
      running=true
      try{
        const dates=[adjacentDay(day,-1),day,...(day<today?[adjacentDay(day,1)]:[])]
        const pages=await Promise.all(dates.map(date=>{
          const path='/api/attendance?resource=live&date='+encodeURIComponent(date)
          return dedupeInflightJson(path,()=>loadJson(path))
        }))
        if(!cancelled){setResult({day,entries:pages.flatMap(p=>p.entries||[]),at:new Date()});setError(null)}
      }catch(e){if(!cancelled)setError({day,text:e.message||'Buchungen konnten nicht geladen werden.'})}
      finally{running=false}
    }
    load()
    return()=>{cancelled=true}
  },[day,today,revision,loadJson])
  const loaded=result?.day===day
  const failed=error?.day===day
  const effectiveNow=failed&&loaded?result.at:now
  const people=useMemo(()=>loaded?groupLiveAttendance(result.entries,day,effectiveNow):[],[loaded,result,day,effectiveNow])
  const shown=people.filter(p=>p.name.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'))&&(filter==='all'||p.status===filter))
  return <section className="panel habun-live-overview" aria-label="Live-Übersicht">
    <div className="page-heading"><div><h2>Live-Übersicht</h2><p>Arbeitsbeginn, Pausen und Arbeitsende je Mitarbeiter – keine dauerhafte Ortung.</p></div></div>
    <div className="habun-live-filters">
      <label>Mitarbeiter suchen<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name eingeben"/></label>
      <label>Datum<input type="date" value={day} max={today} onChange={e=>{if(e.target.value&&e.target.value<=today)setDay(e.target.value)}}/></label>
      <label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Alle</option>{Object.entries(names).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
      <button className="secondary-button compact" onClick={()=>setDay(today)}>Heute</button><button className="secondary-button compact" onClick={()=>setRevision(r=>r+1)}>Aktualisieren</button>
    </div>
    {loaded&&<small>Letzte Abfrage: {fullClock.format(result.at)} · {shown.length} von {people.length} Mitarbeitern mit Buchungen. Status entspricht der letzten Abfrage; laufende Zeiten sind vorläufig.</small>}
    {failed&&<p role="alert">Aktualisierung fehlgeschlagen: {error.text}{loaded?' · Letzter bekannter Stand.':''}</p>}
    {!loaded&&!failed&&<p role="status">Buchungen werden geladen …</p>}
    {loaded&&!shown.length&&<p>Keine passenden Buchungen vorhanden.</p>}
    {shown.map(p=><article className="habun-live-person" key={p.userId}>
      <div className="habun-live-person-heading"><strong>{p.name}</strong><span className={'habun-live-status '+p.status}>{names[p.status]}</span></div>
      {p.sessions.map((s,i)=><div className="habun-live-shift" key={s.events[0]?.id||i}>
        <small>{[s.site,s.area].filter(Boolean).join(' · ')||'Kein Einsatzort zugeordnet'}{p.sessions.length>1?' · Dienst '+(i+1):''}</small>
        <div className="habun-live-metrics">
          <div><small>Arbeitsbeginn</small><strong>{time(s.start,day)}</strong></div>
          <div><small>Arbeitsende</small><strong>{time(s.end,day)}</strong></div>
          <div><small>Pause insgesamt{s.adjustment!==null?' (korrigiert)':''}</small><strong>{duration(s.pauseMinutes)}</strong></div>
          <div><small>Nettoarbeitszeit</small><strong>{s.netMinutes===null?'–':Math.floor(s.netMinutes/60)+' Std. '+s.netMinutes%60+' Min.'}</strong></div>
        </div>
        {s.pauses.length>0&&<div className="habun-live-pauses">{s.pauses.map((b,j)=><div key={j}><small>Pause {j+1}</small><strong>{time(b.start,day)} – {b.end===null?'offen':time(b.end,day)}</strong><span>{b.start!==null&&b.end!==null?duration(Math.floor((b.end-b.start)/60000)):b.end===null&&j===s.pauses.length-1&&s.runningPauseMinutes!==null?duration(s.runningPauseMinutes)+' bisher':'Dauer nicht vollständig'}</span></div>)}</div>}
        {s.adjustment!==null&&<small>Gebuchte abgeschlossene Pausen: {duration(s.bookedPauseMinutes)} · Korrigierter Pausenwert: {duration(s.adjustment)}</small>}
        {s.warnings.length>0&&<p className="habun-live-warning">Buchungen prüfen: {s.warnings.join(' · ')}</p>}
        <details><summary>Einzelne Buchungen anzeigen ({s.events.length})</summary>{s.events.map((e,j)=><div className="habun-live-event" key={e.id||j}><span>{labels[e.action]||e.action}</span><strong>{time(new Date(e.clientOccurredAt).getTime(),day)}</strong><small>{e.action.startsWith('break')?'Ohne Standort':locations[e.locationStatus]||'Nicht verfügbar'}{e.offlineCaptured?' · Offline erfasst':''}</small></div>)}</details>
      </div>)}
    </article>)}
    <small>Es werden die Buchungen des gewählten Tages und angrenzender Tage ausgewertet. Fehlende Buchungen werden gekennzeichnet; geplante Pausen werden nicht als tatsächlich genommen dargestellt.</small>
  </section>
}
