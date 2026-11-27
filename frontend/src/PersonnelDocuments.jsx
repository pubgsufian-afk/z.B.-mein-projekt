import { useEffect, useRef, useState, useCallback } from 'react'
import { WARNING_REASONS, TERMINATION_TYPES, TERMINATION_GROUNDS, ACK_TEXT, makePersonnelText, normalizePersonnelAddress, validTerminationAddress, recipientNameValid, addressMatchesOtherAccount, defaultSignerFunction } from '../../netlify/functions/_shared/personnel-document-policy.mjs'
import './personnel-documents.css'
const api='/api/personnel-documents'
const funcs=['Inhaber','Geschäftsführer','Personalverantwortlicher','Einsatzleiter','Bevollmächtigter']
const today=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day}
const employeeName=e=>String(e?.fullName||e?.name||'').trim()
const employeeAddress=e=>{const a=e?.postalAddress||e?.address;try{return normalizePersonnelAddress(typeof a==='string'?a:'',employeeName(e))}catch{return ''}}
const fresh=(name,kind='warning',employeeUserId='')=>({id:crypto.randomUUID(),kind,employeeUserId,reason:'',incidentDate:today(),incidentTime:'',location:'',facts:'',duty:'',expected:'',address:'',endDate:'',terminationText:'',salutation:'neutral',surname:'',terminationGround:'none',includeEmploymentNotice:false,resignationDate:'',employeeResignationConfirmed:false,signerFunction:defaultSignerFunction(name),authorized:false,legalReviewed:false})
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
  useEffect(()=>{if(!value&&canvas.current&&active.current===null){canvas.current.getContext('2d').clearRect(0,0,800,250);moved.current=false}},[value])
  const xy=e=>{const r=canvas.current.getBoundingClientRect();return [(e.clientX-r.left)*800/r.width,(e.clientY-r.top)*250/r.height]}
  return <div className="personnel-sign"><strong>{label}</strong><canvas ref={canvas} width="800" height="250" aria-label={label} onPointerDown={e=>{if(active.current!==null)return;active.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);const ctx=e.currentTarget.getContext('2d');ctx.beginPath();ctx.moveTo(...xy(e));ctx.strokeStyle='#111';ctx.lineWidth=4;ctx.lineCap='round'}} onPointerMove={e=>{if(active.current!==e.pointerId)return;const ctx=e.currentTarget.getContext('2d');ctx.lineTo(...xy(e));ctx.stroke();moved.current=true}} onPointerUp={e=>{if(active.current!==e.pointerId)return;active.current=null;if(moved.current)onChange(e.currentTarget.toDataURL('image/png'))}} onPointerCancel={()=>{active.current=null;clear()}}/><button type="button" className="secondary-button compact" onClick={clear}>Unterschrift löschen</button>{value&&<small>Unterschrift erfasst</small>}</div>
}
function PaperRecord({id,onSaved,run,busy}){
  const [deliveredOn,setDate]=useState(today()),[deliveryNote,setNote]=useState(''),[paperConfirmed,setConfirmed]=useState(false),[copy,setCopy]=useState('')
  return <form className="personnel-form" onSubmit={e=>{e.preventDefault();run(async()=>{await request('record-paper',{id,deliveredOn,deliveryNote,paperConfirmed,copy});await onSaved()})}}>
    <p>Erst nach tatsächlicher Übergabe/Zustellung des eigenhändig unterschriebenen Originals erfassen. Der Scan ersetzt das Original nicht.</p>
    <label>Zustelldatum<input type="date" required max={today()} value={deliveredOn} onChange={e=>setDate(e.target.value)}/></label>
    <label>Zustellart / Nachweis<input required minLength={5} maxLength={300} value={deliveryNote} onChange={e=>setNote(e.target.value)}/></label>
    <label>Unterschriebenes Dokument (PDF-Scan bis 3 MB)<input type="file" accept="application/pdf,.pdf" required onChange={e=>{setCopy('');const f=e.target.files?.[0];if(!f)return;if(f.size>3000000){e.target.value='';return}const r=new FileReader();r.onload=()=>setCopy(String(r.result).split(',')[1]||'');r.readAsDataURL(f)}}/></label>
    <label className="personnel-check"><input type="checkbox" required checked={paperConfirmed} onChange={e=>setConfirmed(e.target.checked)}/>Eigenhändig unterschriebenes Original ist tatsächlich zugestellt.</label>
    <button className="primary-button" disabled={busy||!copy||!paperConfirmed}>Papierzustellung dokumentieren</button>
  </form>
}
export default function PersonnelDocuments({session,embedded=false}){
  const admin=['owner','admin'].includes(session.role)&&!embedded
  const [form,setForm]=useState(()=>fresh(session.fullName)),[sign,setSign]=useState(''),[employees,setEmployees]=useState([]),[docs,setDocs]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ok,setOk]=useState(''),[selected,setSelected]=useState(''),[ackSign,setAckSign]=useState(''),[ack,setAck]=useState(false),[paper,setPaper]=useState(''),[pdfLink,setPdfLink]=useState(null)
  const reload=useCallback(async()=>{const result=await request(embedded?'mine':'list');setDocs(result.documents||[])},[embedded])
  useEffect(()=>{reload().catch(e=>setMessage(e.message));if(admin)fetch('/api/registrations',{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Mitarbeiterliste konnte nicht geladen werden.');return r.json()}).then(r=>setEmployees((r.employees||[]).filter(e=>e.status==='active'&&(e.userId||e.id)))).catch(e=>setMessage(e.message))},[admin,reload])
  async function run(fn){if(busy)return;setBusy(true);setMessage('');setOk('');try{await fn()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  useEffect(()=>()=>{if(pdfLink)URL.revokeObjectURL(pdfLink.url)},[pdfLink])
  useEffect(()=>{setPdfLink(null)},[form])
  const change=(key,value)=>{setMessage('');setOk('');setForm(f=>({...f,[key]:value,...(f.kind==='termination'&&key!=='legalReviewed'?{legalReviewed:false}:{})}));setSign('')}
  const field=(key,label,type='text',required=true,maxLength=180)=><label>{label}<input type={type} required={required} maxLength={maxLength} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>
  const area=(key,label,required=true,maxLength=1800)=><label>{label}<textarea required={required} maxLength={maxLength} rows={3} value={form[key]} onChange={e=>change(key,e.target.value)}/></label>
  const pdf=async(id,receipt=false)=>{const response=await fetch(api+'?action='+(receipt?'receipt':'download')+'&id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('PDF konnte nicht geladen werden.');savePdf(await response.blob(),receipt?'Empfangsbestaetigung.pdf':'Personalunterlage.pdf');await reload()}
  const recipient=employees.find(e=>String(e.userId||e.id)===form.employeeUserId)
  const confirmation=form.kind==='termination'&&form.reason==='confirmation'
  const missing=[]
  if(!recipient)missing.push('Mitarbeiter auswählen')
  else if(!employeeName(recipient))missing.push('Mitarbeitername fehlt im Profil')
  if(!form.reason)missing.push(form.kind==='warning'?'Abmahnungsgrund auswählen':'Kündigungsart auswählen')
  if(!form.signerFunction)missing.push('Funktion der unterzeichnenden Person auswählen')
  if(form.kind==='warning'){
    if(!form.incidentDate)missing.push('Datum des Vorfalls auswählen')
    if(form.facts.trim().length<12)missing.push('Vorfall kurz und konkret beschreiben (mindestens 12 Zeichen)')
  }else{
    if(recipient&&!recipientNameValid(employeeName(recipient)))missing.push('Vollständigen Mitarbeiternamen im Profil hinterlegen (keine reine Kontonummer)')
    if(addressMatchesOtherAccount(form.address,employeeName(recipient),session.fullName))missing.push('Anschrift enthält den Namen des angemeldeten Kontos statt des ausgewählten Mitarbeiters. Bitte Empfänger prüfen.')
    if(!validTerminationAddress(form.address,employeeName(recipient)))missing.push('Vollständige Empfängeranschrift ergänzen (Straße, Hausnummer, PLZ, Ort)')
    if(form.reason!=='extraordinary'&&!form.endDate)missing.push('Beendigungsdatum auswählen')
    if(confirmation&&(!form.resignationDate||form.resignationDate>today()))missing.push('Datum der vorliegenden Eigenkündigung angeben')
    if(confirmation&&!form.employeeResignationConfirmed)missing.push('Vorliegende Eigenkündigung bestätigen')
    if(!form.legalReviewed)missing.push('Rechtliche Voraussetzungen bestätigen')
  }
  let draft=null
  if(!missing.length){try{draft=makePersonnelText(form,employeeName(recipient))}catch(e){missing.push(e.message||'Angaben prüfen')}}
  const ready=Boolean(draft)
  const preview=()=>run(async()=>{
    if(!ready){setMessage('Bitte zuerst: '+missing.join('; ')+'.');return}
    const blob=await request('preview',{...form,authorized:true})
    setPdfLink({url:URL.createObjectURL(blob),name:'Personalunterlage-Vorschau.pdf'})
    setOk('PDF-Vorschau erstellt. Du kannst sie unten öffnen oder speichern.')
  })
  const downloadNotice=()=>run(async()=>{
    const blob=await request('termination-notice')
    if(!(blob instanceof Blob)||blob.type!=='application/pdf')throw Error('Das Merkblatt konnte nicht als PDF geladen werden.')
    savePdf(blob,'Merkblatt-zur-Kuendigung.pdf')
    setOk('Merkblatt separat heruntergeladen. Bitte rechtzeitig an den Mitarbeiter übergeben.')
  })
  const submitDocument=(mode)=>run(async()=>{
    const result=await request('create',{...form,signature:sign,authorized:true})
    // Creation is already committed: a failed send must not create another copy.
    setForm(fresh(session.fullName,form.kind));setSign('');setSelected(result.id)
    await reload()
    if(mode==='send'){
      await request('publish',{id:result.id});await reload();setOk('Abmahnung im persönlichen Postfach zugestellt.')
    }else{
      await pdf(result.id);setOk(form.kind==='termination'&&!confirmation&&sign?'Digital unterschriebene interne Kopie gespeichert. Das Papieroriginal bitte separat eigenhändig unterschreiben und zustellen.':'Dokument gespeichert. PDF zum Ausdrucken heruntergeladen.')
    }
  })
  const confirmAndSubmit=(mode)=>{
    if(!ready||!draft||(form.kind==='warning'&&!sign))return
    const action=mode==='send'?'ins persönliche Postfach senden':'speichern und PDF herunterladen'
    if(window.confirm('Dokument für '+employeeName(recipient)+' '+action+'? Ich habe die Angaben geprüft und bin zur Unterzeichnung berechtigt.'))submitDocument(mode)
  }
  return <div className="personnel-view">
    {admin&&<section className="panel"><div className="page-heading"><div><h2>Personalunterlagen erstellen</h2><p>Abmahnungen und Kündigungen – ausschließlich für Administratoren.</p></div></div>
      <div className="personnel-mode" role="group" aria-label="Dokumentart">
        <button type="button" className={form.kind==='warning'?'primary-button':'secondary-button'} aria-pressed={form.kind==='warning'} onClick={()=>{if(form.kind!=='warning'){setForm({...fresh(session.fullName,'warning',form.employeeUserId),address:form.address});setSign('')}}}>Abmahnung</button>
        <button type="button" className={form.kind==='termination'?'primary-button':'secondary-button'} aria-pressed={form.kind==='termination'} onClick={()=>{if(form.kind!=='termination'){setForm({...fresh(session.fullName,'termination',form.employeeUserId),address:form.address||employeeAddress(recipient)});setSign('')}}}>Kündigung</button>
      </div>
      <form className="personnel-form" onSubmit={e=>e.preventDefault()} data-testid="personnel-quick-form">
        <label>Mitarbeiter<select aria-label="Mitarbeiter" data-testid="personnel-employee" required value={form.employeeUserId} onChange={e=>{
          const uid=e.target.value,employee=employees.find(x=>String(x.userId||x.id)===uid)
          setMessage('');setOk('');setForm(f=>({...f,employeeUserId:uid,address:employeeAddress(employee),salutation:'neutral',surname:'',employeeResignationConfirmed:false,legalReviewed:false}));setSign('')
        }}><option value="">Mitarbeiter auswählen</option>{employees.map(e=><option key={e.userId||e.id} value={e.userId||e.id}>{employeeName(e)||'Mitarbeiter'}{employees.filter(x=>employeeName(x)===employeeName(e)).length>1?' · Konto …'+String(e.userId||e.id).slice(-8):''}</option>)}</select></label>
        <label>{form.kind==='warning'?'Abmahnungsgrund':'Kündigungsart'}<select aria-label={form.kind==='warning'?'Abmahnungsgrund':'Kündigungsart'} required value={form.reason} onChange={e=>{setMessage('');setOk('');setForm(f=>({...f,reason:e.target.value,expected:'',...(f.kind==='termination'?{endDate:'',terminationText:'',terminationGround:'none',includeEmploymentNotice:false,resignationDate:'',employeeResignationConfirmed:false,legalReviewed:false}:{})}));setSign('')}}><option value="">Bitte auswählen</option>{Object.entries(form.kind==='warning'?WARNING_REASONS:TERMINATION_TYPES).map(([k,v])=><option key={k} value={k}>{Array.isArray(v)?v[0]:v}</option>)}</select></label>
        {form.kind==='warning'?<>
          {field('incidentDate','Datum des Vorfalls (heute voreingestellt)','date')}
          <label>Was ist passiert?<textarea aria-label="Was ist passiert?" required maxLength={1800} rows={3} value={form.facts} onChange={e=>change('facts',e.target.value)} placeholder="Kurz beschreiben: Uhrzeit, Einsatzort, konkreter Vorfall. Keine Vermutungen."/></label>
          <small>Beispiel: Dienstbeginn 06:00 Uhr, am Objekt X erst um 06:25 Uhr erschienen.</small>
        </>:<>
          <label>Anrede<select aria-label="Anrede" value={form.salutation} onChange={e=>change('salutation',e.target.value)}><option value="neutral">Neutral – Guten Tag</option><option value="herr">Herr</option><option value="frau">Frau</option></select></label>
          {form.salutation!=='neutral'&&field('surname','Nachname für die Anrede')}
          {confirmation&&<label>Datum der Eigenkündigung<input aria-label="Datum der Eigenkündigung" type="date" required max={today()} value={form.resignationDate} onChange={e=>change('resignationDate',e.target.value)}/></label>}
          {form.reason!=='extraordinary'&&field('endDate','Beendigungsdatum','date')}
          {!confirmation&&<label>Kündigungsgrund (optional)<select aria-label="Kündigungsgrund (optional)" value={form.terminationGround} onChange={e=>change('terminationGround',e.target.value)}>{Object.entries(TERMINATION_GROUNDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
          {!confirmation&&form.terminationGround==='other'&&area('terminationText','Sonstiger rechtlich geprüfter Kündigungsgrund',true,900)}
          <label>Empfängeranschrift (prüfen)<textarea aria-label="Empfängeranschrift (prüfen)" required maxLength={400} rows={3} value={form.address} onChange={e=>change('address',e.target.value)} onBlur={()=>{try{const normalized=normalizePersonnelAddress(form.address,employeeName(recipient));if(normalized!==form.address){setForm(f=>({...f,address:normalized}));setMessage('');setOk('');setSign('')}}catch{}}} placeholder={'Musterstraße 12\n30159 Hannover'}/></label>
          <small>Straße und Hausnummer sowie PLZ und Ort; eine vollständige einzeilige deutsche Anschrift wird automatisch formatiert. Bitte nur die Anschrift des ausgewählten Mitarbeiters eintragen.</small>
          {confirmation&&<label className="personnel-check"><input aria-label="Eigenkündigung liegt vor" type="checkbox" checked={form.employeeResignationConfirmed} onChange={e=>change('employeeResignationConfirmed',e.target.checked)}/><span>Die Kündigung des Mitarbeiters liegt tatsächlich vor.</span></label>}
          <label className="personnel-check"><input aria-label="Rechtliche Voraussetzungen geprüft" type="checkbox" checked={form.legalReviewed} onChange={e=>change('legalReviewed',e.target.checked)} required/><span>{confirmation?'Die Eigenkündigung und das tatsächliche Beendigungsdatum wurden geprüft.':form.reason==='extraordinary'?'Wichtiger Grund, Erklärungsfrist und Kündigungsschutz sowie erforderliche Beteiligungen sind geprüft.':form.reason==='probation'?'Vereinbarte Probezeit, maßgebliche Kündigungsfrist, Kündigungsschutz und erforderliche Beteiligungen sind geprüft.':'Kündigungsfrist, Kündigungsschutz und erforderliche Beteiligungen sind geprüft.'}</span></label>
          <p>{confirmation?'Die Bestätigung dokumentiert die Eigenkündigung und kann digital unterschrieben werden. Sie ersetzt nicht die Kündigung des Mitarbeiters.':'Die Kündigung wird als druckfertiges PDF erstellt. Das Papieroriginal muss eigenhändig unterschrieben und zugestellt werden (§ 623 BGB).'}</p>
          {!confirmation&&<label>Hinweis zur Agentur für Arbeit<select aria-label="Hinweis zur Agentur für Arbeit" value={form.includeEmploymentNotice?'letter':'separate'} onChange={e=>change('includeEmploymentNotice',e.target.value==='letter')}><option value="separate">Nur separates Merkblatt</option><option value="letter">Zusätzlich im Kündigungsschreiben</option></select></label>}
          {!confirmation&&<div className="personnel-auto"><strong>Separates Mitarbeitermerkblatt</strong><span>Bitte informieren Sie den Mitarbeiter rechtzeitig über die Arbeitsuchendmeldung (§ 2 Abs. 2 Nr. 3 SGB III). Das Merkblatt kann unabhängig von der Kündigung ausgedruckt und übergeben werden. Es wird nicht automatisch gespeichert oder versendet.</span><button type="button" className="secondary-button" disabled={busy} onClick={downloadNotice}>Merkblatt herunterladen / drucken</button></div>}
        </>}
        <div className="personnel-auto"><strong>Automatisch ausgefüllt</strong><span>Firmenlogo · Firmendaten · Name: {session.fullName||'aus angemeldetem Konto'} · {form.signerFunction}</span></div>
        <details className="personnel-extra"><summary>Weitere Angaben (optional)</summary>
          {form.kind==='warning'?<>{field('incidentTime','Uhrzeit','time',false)}{field('location','Einsatzort / Objekt','text',false)}{area('duty','Verletzte Pflicht / bekannte Dienstanweisung',false,650)}{area('expected','Künftig erwartetes Verhalten (sonst automatisch)',false,450)}{area('address','Empfängeranschrift (optional)',false,400)}</>:(!confirmation&&form.terminationGround!=='other'?area('terminationText',form.reason==='extraordinary'?'Rechtlich geprüfte Begründung / Zusatztext (optional)':'Rechtlich geprüfter Zusatztext (optional)',false,900):null)}
          <label>Funktion der unterzeichnenden Person<select value={form.signerFunction} onChange={e=>change('signerFunction',e.target.value)}>{funcs.filter(x=>x!=='Inhaber'||defaultSignerFunction(session.fullName)==='Inhaber').map(x=><option key={x}>{x}</option>)}</select></label>
        </details>
        {draft&&<details className="personnel-extra" open><summary>Fertiger Text – bitte prüfen</summary><div className="personnel-draft"><strong>{draft.title}</strong>{draft.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div></details>}
        <Signature value={sign} onChange={setSign} label={form.kind==='warning'?'Unterschrift':'Digitale Unterschrift des Unterzeichners'}/><small>Bitte nach dem Ausfüllen unterschreiben. Änderungen an den Angaben setzen die Unterschrift aus Sicherheitsgründen zurück.</small>
        {form.kind==='termination'&&!confirmation&&<small>Die digital unterschriebene PDF ist eine interne Kopie. Für die wirksame Kündigung bitte die PDF-Vorschau ohne Unterschrift ausdrucken, eigenhändig unterschreiben und das Original zustellen (§ 623 BGB).</small>}
        <div className="personnel-readiness" aria-live="polite">
          {missing.length>0?<><strong>Für das PDF fehlt noch:</strong><span>{missing.join(' · ')}</span></>:<strong>PDF ist bereit. {form.kind==='warning'&&!sign?'Zum Versenden oder endgültigen Speichern bitte unterschreiben.':''}</strong>}
        </div>
        <div className="personnel-actions personnel-quick-actions">
          <button type="button" className="secondary-button" data-direct-pdf-download="true" disabled={busy} onClick={preview}>PDF-Vorschau (ohne Unterschrift)</button>
          {form.kind==='warning'&&<button type="button" className="primary-button" disabled={busy||!draft||!sign} onClick={()=>confirmAndSubmit('send')}>Unterschreiben &amp; senden</button>}
          <button type="button" className={form.kind==='warning'?'secondary-button':'primary-button'} disabled={busy||!draft||(form.kind==='warning'&&!sign)} onClick={()=>confirmAndSubmit('print')}>{form.kind==='termination'&&sign?'Digital unterschreiben & PDF speichern':'PDF speichern / drucken'}</button>
          {pdfLink&&<a className="secondary-button personnel-pdf-link" href={pdfLink.url} target="_blank" rel="noopener noreferrer">PDF öffnen / drucken</a>}
          {pdfLink&&<a className="secondary-button personnel-pdf-link" href={pdfLink.url} download={pdfLink.name}>PDF herunterladen</a>}
        </div>
        {message&&<p role="alert" className="personnel-warning">{message}</p>}
        {ok&&<p role="status">{ok}</p>}
      </form>
    </section>}
    <section className="panel"><h2>{admin?'Personalunterlagen – Archiv':'Meine Personalunterlagen'}</h2>
      {!admin&&<p>Abmahnungen und weitere persönliche Dokumente. Die Unterschrift bestätigt nur den Erhalt, nicht den Inhalt.</p>}
      {!admin&&message&&<p role="alert" className="personnel-warning">{message}</p>}{!admin&&ok&&<p role="status">{ok}</p>}
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
