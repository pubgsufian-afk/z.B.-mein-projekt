import { useState,useEffect,useCallback } from 'react'
import './portal-messages.css'
const url='/api/portal-notifications'
async function loadNotice(body){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
 if(!r.ok)throw Error('Benachrichtigungen konnten nicht geladen werden.')
 return r.json()
}
export function NotificationsBell({onClick,accountId}){
 const [count,setCount]=useState(0)
 useEffect(()=>{
   let active=true;setCount(0)
   const refresh=()=>loadNotice().then(data=>{if(active)setCount(Number(data.unreadCount)||0)}).catch(()=>{})
   refresh();const timer=setInterval(refresh,45000)
   window.addEventListener('focus',refresh);window.addEventListener('habun-notice-refresh',refresh)
   return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('habun-notice-refresh',refresh)}
 },[accountId])
 return <button type="button" className="portal-bell" aria-label={'Benachrichtigungen'+(count?' ('+count+' ungelesen)':'')} onClick={onClick}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round"/></svg>{count>0&&<span className="portal-bell-count">{count>99?'99+':count}</span>}</button>
}
export function NotificationsPage({onNavigate}){
 const [items,setItems]=useState([]),[count,setCount]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const refresh=useCallback(async()=>{try{const data=await loadNotice();setItems(data.notifications||[]);setCount(data.unreadCount||0);setError('')}catch(e){setError(e.message)}},[])
 useEffect(()=>{refresh();const id=setInterval(refresh,45000);window.addEventListener('focus',refresh);return()=>{clearInterval(id);window.removeEventListener('focus',refresh)}},[refresh])
 async function mark(body,target){setBusy(true);try{await loadNotice(body);window.dispatchEvent(new Event('habun-notice-refresh'));await refresh();if(target){const view=new URL(target,window.location.origin).searchParams.get('view');if(view)onNavigate(view);else onNavigate('overview')}}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="panel portal-notices"><div className="page-heading"><div><h2>Meine Benachrichtigungen</h2><p>{count} ungelesen · Mitteilungen bleiben auch ohne aktivierte Geräte-Pushs im Portal erhalten.</p></div></div>
 <div className="portal-message-actions"><button type="button" className="secondary-button compact" disabled={busy} onClick={refresh}>Aktualisieren</button><button type="button" className="secondary-button compact" disabled={busy||!count} onClick={()=>mark({action:'read-all'})}>Alle als gelesen markieren</button></div>
 {error&&<p role="alert">{error}</p>}
 {items.length===0&&!error&&<p>Keine Mitteilungen vorhanden.</p>}
 {items.map(n=><article key={n.id} className={'portal-notice-entry'+(!n.readAt?' unread':'')}><div><strong>{n.title}</strong>{!n.readAt&&<span className="portal-new">Neu</span>}<p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString('de-DE')}</small></div><div className="portal-message-actions"><button type="button" className="secondary-button compact" disabled={busy} onClick={()=>mark({action:'read',id:n.id},n.url)}>Öffnen</button>{!n.readAt&&<button type="button" className="secondary-button compact" disabled={busy} onClick={()=>mark({action:'read',id:n.id})}>Gelesen</button>}</div></article>)}
 </section>
}
