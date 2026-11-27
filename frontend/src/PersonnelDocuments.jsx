import { useEffect, useRef, useState, useCallback } from 'react'
import { WARNING_REASONS, TERMINATION_TYPES, ACK_TEXT, makePersonnelText } from '../../netlify/functions/_shared/personnel-document-policy.mjs'
import './personnel-documents.css'
const api='/api/personnel-documents'
const funcs=['Inhaber','Geschäftsführer','Personalverantwortlicher','Einsatzleiter','Bevollmächtigter']
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const fresh=(role,kind='warning',employeeUserId='')=>({id:crypto.randomUUID(),kind,employeeUserId,reason:'',incidentDate:today(),incidentTime:'',location:'',facts:'',duty:'',expected:'',address:'',endDate:'',terminationText:'',signerFunction:role==='owner'?'Inhaber':'Bevollmächtigter',authorized:false,legalReviewed:false})
async function request(action='list',body){
  const res=await fetch(api+'?action='+action,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
  if(!res.ok){const err=await res.json().catch(()=>({}));throw Error(err.message||'Anfrage fehlgeschlagen.')}
  return res.headers.get('content-type')?.includes('application/pdf')?res.blob():res.json()
}
function savePdf(blob,name){
  const url=URL.createObjectURL(blob), a=document.createElement('a')
  a.href=url;a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
}
function Signature({value,onChange,label}){
  const canvas=useRef(null),active=useRef(null),moved=useRef(false)
  const clear=()=>{canvas.current.getContext('2d').clearRect(0,0,800,250);onChange('');moved.current=false}
  useEffect(()=>{if(!value&&canvas.current&&!active.current)canvas.current.getContext('2d').clearRect(0,0,800,250)},[value])
  const xy=e=>{const r=canvas.current.getBoundingClientRect();return [(e.clientX-r.left)*800/r.width,(e.clientY-r.top)*250/r.height]}
  return <div className="personnel-sign"><strong>{label}</strong><canvas ref={canvas} width="800" height="250" aria-label={label} onPointerDown={e=>{if(active.current!==null)return;active.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);const ctx=e.currentTarget.getContext('2d');ctx.beginPath();ctx.moveTo(...xy(e));ctx.strokeStyle='#111';ctx.lineWidth=4;ctx.lineCap='round'}} onPointerMove={e=>{if(active.current!==e.pointerId)return;const ctx=e.currentTarget.getContext('2d');ctx.lineTo(...xy(e));ctx.stroke();moved.current=true}} onPointerUp={e=>{if(active.current!==e.pointerId)return;active.current=null;if(moved.current)onChange(e.currentTarget.toDataURL('image/png'))}} onPointerCancel={()=>{active.current=null;clear()}}/><button type="button" className="secondary-button compact" onClick={clear}>Unterschrift löschen</button>{value&&<small>Unterschrift erfasst</small>}</div>
}
function PaperRecord({id,onSaved,run,busy}){
  const [deliveredOn,setDate]=useState(today()),[deliveryNote,setNote]=useState(''),[paperConfirmed,setConfirmed]=useState(false),[copy,setCopy]=useState('')
  return <form className="personnel-form" onSubmit={e=>{e.preventDefault();run(async()=>{await request('record-paper',{id,deliveredOn,deliveryNote,paperConfirmed,copy});await onSaved()})}}>
    <p>Erst nach tatsächlicher Übergabe/Zustellung des eigenhändig unterschriebenen Originals erfassen. Der Scan ersetzt das Original nicht.</p>
    <label>Zustelldatum<input type="date" required max={today()} value={deliveredOn} onChange={e=>setDate(e.target.value)}/></label>
    <label>Zustellart / Nachweis<input required minLength={5} maxLength={300} value={deliveryNote} onChange={e=>setNote(e.target.value)}/></label>
    <label>Unterschriebene Kündigung (PDF-Scan bis 3 MB)<input type="file" accept="application/pdf,.pdf" required onChange={e=>{setCopy('');const f=e.target.files?.[0];if(!f)return;if(f.size>3000000){e.target.value='';return}const r=new FileReader();r.onload=()=>setCopy(String(r.result).split(',')[1]||'');r.readAsDataURL(f)}}/></label>
    <label className="personnel-check"><input type="checkbox" required checked={paperConfirmed} onChange={e=>setConfirmed(e.target.checked)}/>Eigenhändig unterschriebenes Original ist tatsächlich zugestellt.</label>
    <button className="primary-button" disabled={busy||!copy||!paperConfirmed}>Papierzustellung dokumentieren</button>
  </form>
}
export default function PersonnelDocuments({session,embedded=false}){
  const admin=['owner','admin'].includes(session.role)&&!embedded
  const [form,setForm]=useState(()=>fresh(session.role)),[sign,setSign]=useState(''),[employees,setEmployees]=useState([]),[docs,setDocs]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ok,setOk]=useState(''),[selected,setSelected]=useState(''),[ackSign,setAckSign]=useState(''),[ack,setAck]=useState(false),[paper,setPaper]=useState('')
  const reload=useCallback(async()=>{const result=await request(embedded?'mine':'list');setDocs(result.documents||[])},[embedded])
  useEffect(()=>{reload().catch(e=>setMessage(e.message));if(admin)fetch('/api/registrations',{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Mitarbeiterliste konnte nicht geladen werden.');return r.json()}).then(r=>setEmployees((r.employees||[]).filter(e=>e.status==='active'&&(e.userId||e.id)))).catch(e=>setMessage(e.message))},[admin,reload])
  async function run(fn){if(busy)return;setBusy(true);setMessage('');setOk('');try{await fn()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  const change=(key,value)=>{setForm(f=>({...f,[key]:value}));setSign('')}
  const field=(key,label,type='text',required=true,maxLength=180)=><label>{label}<input type={type} required={required} maxLength={maxLength} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>
  const area=(key,label,required=true,maxLength=1800)=><label>{label}<textarea required={required} maxLength={maxLength} rows={3} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>
  const pdf=async(id,receipt=false)=>{const response=await fetch(api+'?action='+(receipt?'receipt':'download')+'&id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('PDF konnte nicht geladen werden.');savePdf(await response.blob(),receipt?'Empfangsbestaetigung.pdf':'Personalunterlage.pdf');await reload()}
  const recipient=employees.find(e=>String(e.userId||e.id)===form.employeeUserId)
  const ready=!!(recipient&&form.reason&&form.signerFunction&&(form.kind==='warning'?(form.incidentDate&&form.facts.trim().length>=12):(form.address.trim()&&form.legalReviewed&&(form.reason==='extraordinary'||form.endDate))))
  let draft=null
  if(ready){try{draft=makePersonnelText(form,recipient.fullName)}catch{}}
  const submitDocument=(mode)=>run(async()=>{
    const result=await request('create',{...form,signature:sign,authorized:true})
    // Creation is already committed: a failed send must not create another copy.
    setForm(fresh(session.role,form.kind));setSign('');setSelected(result.id)
    await reload()
    if(mode==='send'){
      await request('publish',{id:result.id});await reload();setOk('Abmahnung im persönlichen Postfach zugestellt.')
    }else{
      await pdf(result.id);setOk('Dokument gespeichert. PDF zum Ausdrucken heruntergeladen.')
    }
  })
  const confirmAndSubmit=(mode)=>{
    if(!ready||!draft||(form.kind==='warning'&&!sign))return
    const action=mode==='send'?'ins persönliche Postfach senden':'speichern und PDF herunterladen'
    if(window.confirm('Dokument für '+recipient.fullName+' '+action+'? Ich habe die Angaben geprüft und bin zur Unterzeichnung berechtigt.'))submitDocument(mode)
  }
  return <div className="personnel-view">
    {admin&&<section className="panel"><div className="page-heading"><div><h2>Personalunterlagen erstellen</h2><p>Abmahnungen und Kündigungen – ausschließlich für Administratoren.</p></div></div>
      <div className="personnel-mode" role="group" aria-label="Dokumentart">
        <button type="button" className={form.kind==='warning'?'primary-button':'secondary-button'} aria-pressed={form.kind==='warning'} onClick={()=>{if(form.kind!=='warning'){setForm(fresh(session.role,'warning',form.employeeUserId));setSign('')}}}>Abmahnung</button>
        <button type="button" className={form.kind==='termination'?'primary-button':'secondary-button'} aria-pressed={form.kind==='termination'} onClick={()=>{if(form.kind!=='termination'){setForm(fresh(session.role,'termination',form.employeeUserId));setSign('')}}}>Kündigung</button>
      </div>
      <form className="personnel-form" onSubmit={e=>e.preventDefault()} data-testid="personnel-quick-form">
        <label>Mitarbeiter<select aria-label="Mitarbeiter" data-testid="personnel-employee" required value={form.employeeUserId} onChange={e=>{
          const uid=e.target.value,employee=employees.find(x=>String(x.userId||x.id)===uid)
          const address=employee?.postalAddress||employee?.address
          const postal=typeof address==='string'?address.trim():''
          setForm(f=>({...f,employeeUserId:uid,address:postal}));setSign('')
        }}><option value="">Mitarbeiter auswählen</option>{employees.map(e=><option key={e.userId||e.id} value={e.userId||e.id}>{e.fullName||'Mitarbeiter'}{employees.filter(x=>x.fullName===e.fullName).length>1?' · Konto …'+String(e.userId||e.id).slice(-8):''}</option>)}</select></label>
        <label>{form.kind==='warning'?'Abmahnungsgrund':'Kündigungsart'}<select aria-label={form.kind==='warning'?'Abmahnungsgrund':'Kündigungsart'} required value={form.reason} onChange={e=>{setForm(f=>({...f,reason:e.target.value,expected:''}));setSign('')}}><option value="">Bitte auswählen</option>{Object.entries(form.kind==='warning'?WARNING_REASONS:TERMINATION_TYPES).map(([k,v])=><option key={k} value={k}>{Array.isArray(v)?v[0]:v}</option>)}</select></label>
        {form.kind==='warning'?<>
          {field('incidentDate','Datum des Vorfalls (heute voreingestellt)','date')}
          <label>Was ist passiert?<textarea aria-label="Was ist passiert?" required maxLength={1800} rows={3} value={form.facts} onChange={e=>change('facts',e.target.value)} placeholder="Kurz beschreiben: Uhrzeit, Einsatzort, konkreter Vorfall. Keine Vermutungen."/></label>
          <small>Beispiel: Dienstbeginn 06:00 Uhr, am Objekt X erst um 06:25 Uhr erschienen.</small>
        </>:<>
          {form.reason!=='extraordinary'&&field('endDate','Beendigungsdatum','date')}
          {area('address','Empfängeranschrift (prüfen)',true,400)}
          <label className="personnel-check"><input type="checkbox" checked={form.legalReviewed} onChange={e=>change('legalReviewed',e.target.checked)} required/>Kündigungsfrist, Kündigungsschutz und erforderliche Beteiligungen sind geprüft.</label>
          <p>Die Kündigung wird als druckfertiges PDF erstellt. Das Papieroriginal muss eigenhändig unterschrieben und zugestellt werden (§ 623 BGB).</p>
        </>}
        <div className="personnel-auto"><strong>Automatisch ausgefüllt</strong><span>Firmenlogo · Firmendaten · Name: {session.fullName||'aus angemeldetem Konto'} · {form.signerFunction}</span></div>
        <details className="personnel-extra"><summary>Weitere Angaben (optional)</summary>
          {form.kind==='warning'?<>{field('incidentTime','Uhrzeit','time',false)}{field('location','Einsatzort / Objekt','text',false)}{area('duty','Verletzte Pflicht / bekannte Dienstanweisung',false,650)}{area('expected','Künftig erwartetes Verhalten (sonst automatisch)',false,450)}{area('address','Empfängeranschrift (optional)',false,400)}</>:area('terminationText','Rechtlich geprüfter Zusatztext (optional)',false,900)}
          <label>Funktion der unterzeichnenden Person<select value={form.signerFunction} onChange={e=>change('signerFunction',e.target.value)}>{funcs.map(x=><option key={x}>{x}</option>)}</select></label>
        </details>
        {draft&&<details className="personnel-extra" open><summary>Fertiger Text – bitte prüfen</summary><div className="personnel-draft"><strong>{draft.title}</strong>{draft.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div></details>}
        {draft&&form.kind==='warning'&&<Signature value={sign} onChange={setSign} label="Unterschrift"/>}
        <div className="personnel-actions personnel-quick-actions">
          {form.kind==='warning'&&<button type="button" className="primary-button" disabled={busy||!draft||!sign} onClick={()=>confirmAndSubmit('send')}>Unterschreiben &amp; senden</button>}
          <button type="button" className={form.kind==='warning'?'secondary-button':'primary-button'} disabled={busy||!draft||(form.kind==='warning'&&!sign)} onClick={()=>confirmAndSubmit('print')}>PDF speichern / drucken</button>
          {draft&&<button type="button" className="secondary-button compact" data-direct-pdf-download="true" disabled={busy} onClick={()=>run(async()=>savePdf(await request('preview',{...form,authorized:true}),'Personalunterlage-Vorschau.pdf'))}>PDF-Vorschau</button>}
        </div>
      </form>
    </section>}
    <section className="panel"><h2>{admin?'Personalunterlagen – Archiv':'Meine Personalunterlagen'}</h2>
      {!admin&&<p>Abmahnungen und weitere persönliche Dokumente. Die Unterschrift bestätigt nur den Erhalt, nicht den Inhalt.</p>}
      {message&&<p role="alert" className="personnel-warning">{message}</p>}{ok&&<p role="status">{ok}</p>}
      <button className="secondary-button compact" type="button" disabled={busy} onClick={()=>run(reload)}>Aktualisieren</button>
      {docs.map(doc=><article key={doc.id} className="personnel-entry"><strong>{doc.title}{admin?' · '+doc.employeeName:''}</strong><span>Erstellt: {new Date(doc.createdAt).toLocaleString('de-DE')} · {doc.creatorName} ({doc.creatorFunction})</span>{admin&&<span>{doc.reason} · {doc.publishedAt?'Im Postfach bereitgestellt':'Noch nicht versendet'}</span>}<span>{doc.openedAt?'Geöffnet: '+new Date(doc.openedAt).toLocaleString('de-DE'):'Noch nicht geöffnet'} · {doc.acknowledgedAt?'Empfang bestätigt':'Empfang nicht bestätigt'}</span>
      {doc.paperDeliveredOn&&<span>Papierzustellung dokumentiert: {String(doc.paperDeliveredOn).slice(0,10)}</span>}
      <div className="personnel-actions"><button type="button" className="secondary-button compact" disabled={busy} onClick={()=>run(()=>pdf(doc.id))}>PDF herunterladen / drucken</button>{doc.acknowledgedAt&&<button type="button" className="secondary-button compact" disabled={busy} onClick={()=>run(()=>pdf(doc.id,true))}>Empfangsbestätigung PDF</button>}
      {admin&&doc.kind==='termination'&&!doc.paperDeliveredOn&&!doc.publishedAt&&<button type="button" className="secondary-button compact" onClick={()=>setPaper(paper===doc.id?'':doc.id)}>Papierzustellung erfassen</button>}
      {admin&&doc.canPublish&&<button type="button" className="primary-button compact" disabled={busy} onClick={()=>{if(window.confirm('Dieses Dokument wirklich an '+doc.employeeName+' ins persönliche Postfach senden?'))run(async()=>{await request('publish',{id:doc.id});await reload();setOk('Dokument im persönlichen Postfach bereitgestellt.')})}}>Ins Postfach senden</button>}
      {!admin&&doc.canAcknowledge&&<button type="button" className="secondary-button compact" disabled={busy} onClick={()=>{setSelected(selected===doc.id?'':doc.id);setAck(false);setAckSign('')}}>Empfang bestätigen</button>}</div>
      {admin&&paper===doc.id&&<PaperRecord id={doc.id} run={run} busy={busy} onSaved={async()=>{setPaper('');await reload();setOk('Papierzustellung dokumentiert. Die Kopie kann jetzt ins Postfach gesendet werden.')}}/>}
      {!admin&&selected===doc.id&&doc.canAcknowledge&&<div className="personnel-form"><p>{ACK_TEXT}</p><label className="personnel-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Ich bestätige den Erhalt.</label><Signature key={doc.id} value={ackSign} onChange={setAckSign} label="Unterschrift des Empfängers"/><button className="primary-button" disabled={!ack||!ackSign||busy} onClick={()=>run(async()=>{await request('acknowledge',{id:doc.id,accepted:ack,signature:ackSign});setSelected('');setAckSign('');setAck(false);await reload();setOk('Empfang bestätigt.')})}>Empfang verbindlich dokumentieren</button></div>}
      </article>)}
      {!docs.length&&!message&&<p>Noch keine Personalunterlagen vorhanden.</p>}
    </section>
  </div>
}
