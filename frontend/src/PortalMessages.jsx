import { useState,useEffect,useCallback,useRef } from 'react'
import './portal-messages.css'
const endpoint='/api/portal-messages',maxBytes=3*1024*1024
async function api(action='list',body){
 const r=await fetch(endpoint+'?action='+action,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
 if(!r.ok){const err=await r.json().catch(()=>({}));throw Error(err.message||'Postfachnachricht konnte nicht verarbeitet werden.')}
 return r.json()
}
export default function PortalMessages({session,employees=[]}){
 const admin=['owner','admin'].includes(session.role)
 const [rows,setRows]=useState([]),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[recipient,setRecipient]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('')
 const input=useRef(null),id=useRef(crypto.randomUUID()),form=useRef(null)
 const directory=employees.filter(e=>e.status==='active'&&(e.userId||e.id))
 const nameFor=uid=>directory.find(e=>String(e.userId||e.id)===String(uid))?.fullName||'Mitarbeiter'
 const refresh=useCallback(async()=>{try{setRows((await api()).messages||[])}catch(e){setError(e.message)}},[])
 useEffect(()=>{refresh();const timer=setInterval(refresh,45000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh)}},[refresh])
 function choose(e){const picked=e.target.files?.[0]||null;setFile(null);setError('');if(!picked)return;if(picked.size>maxBytes){setError('Anhänge dürfen maximal 3 MB groß sein.');e.target.value='';return}if(!/\.(pdf|jpg|jpeg|png)$/i.test(picked.name)){setError('Bitte PDF, JPG oder PNG auswählen.');e.target.value='';return}setFile(picked)}
 async function send(e){e.preventDefault();if(busy)return;setBusy(true);setError('');setSuccess('')
 try{
   let attachment=null
   if(file){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(Error('Datei konnte nicht gelesen werden.'));reader.readAsDataURL(file)});attachment={name:file.name,data}}
   await api('send',{id:id.current,subject:subject.trim(),body:body.trim(),...(admin?{recipientUserId:recipient}:{}),attachment})
   setSubject('');setBody('');setFile(null);setRecipient('');if(input.current)input.current.value='';id.current=crypto.randomUUID();setSuccess('Nachricht wurde sicher zugestellt.');await refresh()
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 async function download(row){setError('');try{const r=await fetch(endpoint+'?action=download&id='+encodeURIComponent(row.id),{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Anhang konnte nicht geladen werden.');const blob=await r.blob();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=row.attachmentName;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){setError(e.message)}}
 return <section className="panel portal-messages"><div className="page-heading"><div><h2>Nachrichten und Anhänge</h2><p>{admin?'Nachrichten der Mitarbeiter an die Verwaltung und persönliche Antworten.':'Sende der Verwaltung eine Nachricht oder ein Dokument. Nur berechtigte Administratoren erhalten sie.'}</p></div></div>
 <form ref={form} onSubmit={send} className="portal-message-form">
 {admin?<label>Nachricht an<select required value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Mitarbeiter auswählen</option>{directory.map(e=><option key={e.userId||e.id} value={e.userId||e.id}>{e.fullName}{directory.filter(x=>x.fullName===e.fullName).length>1?' · Konto …'+String(e.userId||e.id).slice(-8):''}</option>)}</select></label>:<p><strong>Empfänger:</strong> Verwaltung</p>}
 <label>Betreff der Nachricht<input required maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="z. B. Unterlagen, Rückfrage oder Krankmeldung"/></label>
 <label>Nachricht<textarea maxLength={6000} rows={4} value={body} onChange={e=>setBody(e.target.value)} placeholder="Deine Nachricht …"/></label>
 <label>Anhang (optional, PDF/JPG/PNG bis 3 MB)<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={choose}/></label>
 {file&&<small>{file.name} · {(file.size/1048576).toFixed(2)} MB</small>}
 <button type="submit" className="primary-button" disabled={busy||!subject.trim()||(!body.trim()&&!file)||(admin&&!recipient)}>{busy?'Wird gesendet …':'Nachricht senden'}</button>
 </form>{error&&<p role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
 <div className="portal-message-heading"><h3>Nachrichtenverlauf</h3><button type="button" className="secondary-button compact" onClick={refresh}>Aktualisieren</button></div>
 {rows.length===0&&!error&&<p>Noch keine Nachrichten vorhanden.</p>}
 {rows.map(row=><article key={row.id} className="portal-message-entry"><div><strong>{row.subject}</strong><span>{row.outgoing?'Gesendet an: '+(row.toAdministration?'Verwaltung':nameFor(row.recipientUserId)):'Von: '+row.senderName} · {new Date(row.createdAt).toLocaleString('de-DE')}</span>{row.body&&<p>{row.body}</p>}</div><div className="portal-message-actions">{row.attachmentName&&<button className="secondary-button compact" type="button" onClick={()=>download(row)}>Anhang herunterladen: {row.attachmentName}</button>}{admin&&!row.outgoing&&row.toAdministration&&directory.some(e=>String(e.userId||e.id)===String(row.senderUserId))&&<button type="button" className="secondary-button compact" onClick={()=>{setRecipient(row.senderUserId);setSubject(('AW: '+row.subject).slice(0,160));form.current?.scrollIntoView({block:'start',behavior:'smooth'})}}>Antworten</button>}</div></article>)}
 </section>
}
