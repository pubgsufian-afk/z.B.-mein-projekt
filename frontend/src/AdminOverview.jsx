import { useCallback, useEffect, useMemo, useState } from 'react'
import { ADMIN_OVERVIEW_TIME_ZONE, berlinDateKey, buildDeploymentGroups, countReportWords } from './admin-overview-utils.mjs'
import './admin-overview.css'
import './daily-report-management.css'

const ADMINISTRATION = new Set(['owner', 'admin'])
const MAX_REPORT_WORDS = 1000

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
  if (!response.ok) throw new Error(body.message || `Die Anfrage ist fehlgeschlagen (${response.status}).`)
  return body
}

async function downloadPdf(path) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `PDF-Download fehlgeschlagen (${response.status}).`)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'Tagesbericht.pdf'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Icon({ name }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (name === 'shield') return <svg {...common}><path d="M12 3 19 6v5c0 4.7-2.8 8.1-7 10-4.2-1.9-7-5.3-7-10V6l7-3Z" /><circle cx="12" cy="10" r="2.2" /><path d="M8.8 16c.8-1.5 1.9-2.2 3.2-2.2s2.4.7 3.2 2.2" /></svg>
  if (name === 'file') return <svg {...common}><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4" /><path d="M9 12h6M9 15.5h6" /></svg>
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
  if (name === 'calendar') return <svg {...common}><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 9.5h16" /></svg>
  if (name === 'pencil') return <svg {...common}><path d="m5 19 3.5-.8L18 8.7 15.3 6 5.8 15.5 5 19Z" /><path d="m13.8 7.5 2.7 2.7" /></svg>
  if (name === 'folder') return <svg {...common}><path d="M3.5 7.5h6l1.8-2h9.2v13h-17z" /></svg>
  if (name === 'chevron') return <svg {...common} width="20" height="20"><path d="m7 9 5 5 5-5" /></svg>
  if (name === 'close') return <svg {...common} width="20" height="20"><path d="M6 6l12 12M18 6 6 18" /></svg>
  if (name === 'info') return <svg {...common} width="20" height="20"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  if (name === 'users') return <svg {...common}><circle cx="9" cy="9" r="3" /><path d="M3.8 18c.8-3.1 2.5-4.7 5.2-4.7s4.4 1.6 5.2 4.7" /><path d="M15 6.8a3 3 0 0 1 0 5.7M16 13.5c2.2.5 3.6 2 4.2 4.5" /></svg>
  if (name === 'download') return <svg {...common}><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14" /></svg>
  if (name === 'trash') return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
  return null
}

function formatReportDate(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', { timeZone: ADMIN_OVERVIEW_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function formatReportTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', { timeZone: ADMIN_OVERVIEW_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function formatTodayLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`)
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }).format(date)
}

function StatusRow({ id, label, tone, entries, open, onToggle }) {
  return (
    <div className={`deployment-status deployment-status-${tone}`}>
      <button type="button" className="deployment-status-button" aria-expanded={open} aria-controls={`deployment-group-${id}`} onClick={onToggle}>
        <span className="deployment-status-dot" aria-hidden="true" />
        <span className="deployment-status-label">{label} <b>· {entries.length}</b></span>
        <span className={`deployment-chevron ${open ? 'open' : ''}`}><Icon name="chevron" /></span>
      </button>
      {open && <div id={`deployment-group-${id}`} className="deployment-names">
        {entries.length ? entries.map((entry) => <span key={entry.key}>{entry.name}</span>) : <span className="deployment-empty">Keine Mitarbeiter</span>}
      </div>}
    </div>
  )
}

function DailyReportDialog({
  mode,
  onClose,
  reportText,
  setReportText,
  onSave,
  saving,
  notice,
  reports,
  loadingReports,
  reportDate,
  onDateChange,
  onDayPdf,
  onReportPdf,
  downloadingReport,
  onEdit,
  onDelete,
  deletingReport,
  onCancelDelete,
  onConfirmDelete,
  deletingBusy,
}) {
  const words = countReportWords(reportText)
  const overLimit = words > MAX_REPORT_WORDS
  const editing = mode === 'edit'
  const composing = mode === 'compose' || editing

  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="daily-report-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="daily-report-modal" role="dialog" aria-modal="true" aria-labelledby="daily-report-dialog-title">
        <header className="daily-report-modal-header">
          <div>
            <span className="daily-report-kicker">Tagesbericht</span>
            <h3 id="daily-report-dialog-title">{editing ? 'Bericht bearbeiten' : mode === 'compose' ? 'Bericht schreiben' : 'Gespeicherte Berichte'}</h3>
          </div>
          <button type="button" className="daily-report-close" aria-label="Dialog schließen" onClick={onClose}><Icon name="close" /></button>
        </header>

        {composing ? <div className="daily-report-compose">
          <p className="daily-report-helper">{editing ? 'Der ursprüngliche Verfasser und die Erstellungszeit bleiben erhalten. Die letzte Bearbeitung wird automatisch dokumentiert.' : 'Schreibe den Bericht vollständig. Name, Datum und Uhrzeit werden beim Speichern automatisch ergänzt.'}</p>
          <label htmlFor="daily-report-text">Bericht</label>
          <textarea
            id="daily-report-text"
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            placeholder="Ereignisse, Besonderheiten und wichtige Übergaben des Tages eintragen …"
            rows={12}
            autoFocus
          />
          <div className={`daily-report-counter ${overLimit ? 'limit' : ''}`} aria-live="polite">{words.toLocaleString('de-DE')} / 1.000 Wörter</div>
          {notice && <div className={`daily-report-notice ${notice.tone}`}>{notice.text}</div>}
          <div className="daily-report-modal-actions">
            <button type="button" className="daily-report-secondary" onClick={onClose}>Abbrechen</button>
            <button type="button" className="daily-report-primary" disabled={saving || words === 0 || overLimit} onClick={onSave}>{saving ? 'Wird gespeichert …' : editing ? 'Änderungen speichern' : 'Bericht speichern'}</button>
          </div>
        </div> : <div className="daily-report-history">
          <div className="daily-report-toolbar">
            <label className="daily-report-date-field">
              <span>Datum</span>
              <input aria-label="Datum" type="date" value={reportDate} onChange={(event) => onDateChange(event.target.value)} />
            </label>
            <button type="button" className="daily-report-day-pdf" disabled={loadingReports || !reports.length || downloadingReport === 'day'} onClick={onDayPdf}>
              <Icon name="download" />
              <span>{downloadingReport === 'day' ? 'PDF wird erstellt …' : 'Tages-PDF herunterladen'}</span>
            </button>
          </div>

          {loadingReports ? <div className="daily-report-loading">Berichte werden geladen …</div> : reports.length ? reports.map((report) => (
            <article className="daily-report-entry" key={report.id || report.createdAt}>
              <div className="daily-report-entry-meta">
                <strong>{report.authorName || 'Admin'}</strong>
                <span>Erstellt am {formatReportDate(report.createdAt)} um {formatReportTime(report.createdAt)} Uhr</span>
                {report.updatedAt && <span className="daily-report-edited">Zuletzt bearbeitet am {formatReportDate(report.updatedAt)} um {formatReportTime(report.updatedAt)} Uhr{report.updatedByName ? ` · ${report.updatedByName}` : ''}</span>}
              </div>
              <p>{report.text}</p>
              <div className="daily-report-entry-actions">
                <button type="button" disabled={downloadingReport === report.id} onClick={() => onReportPdf(report)}><Icon name="download" /><span>{downloadingReport === report.id ? 'Lädt …' : 'PDF'}</span></button>
                <button type="button" onClick={() => onEdit(report)}><Icon name="pencil" /><span>Bearbeiten</span></button>
                <button type="button" className="danger" onClick={() => onDelete(report)}><Icon name="trash" /><span>Löschen</span></button>
              </div>
              {deletingReport?.id === report.id && <div className="daily-report-delete-confirm" role="alertdialog" aria-label="Bericht endgültig löschen">
                <strong>Bericht wirklich endgültig löschen?</strong>
                <span>Diese Aktion kann nicht rückgängig gemacht werden.</span>
                <div>
                  <button type="button" className="daily-report-secondary" disabled={deletingBusy} onClick={onCancelDelete}>Abbrechen</button>
                  <button type="button" className="daily-report-delete-button" disabled={deletingBusy} onClick={onConfirmDelete}>{deletingBusy ? 'Wird gelöscht …' : 'Endgültig löschen'}</button>
                </div>
              </div>}
            </article>
          )) : <div className="daily-report-loading">Für dieses Datum sind keine Tagesberichte gespeichert.</div>}
          {notice && <div className={`daily-report-notice ${notice.tone}`}>{notice.text}</div>}
        </div>}
      </section>
    </div>
  )
}

export default function AdminOverview({ session, navigate }) {
  const isAdmin = ADMINISTRATION.has(session.role)
  const [schedule, setSchedule] = useState([])
  const [liveAttendance, setLiveAttendance] = useState([])
  const [overviewNotice, setOverviewNotice] = useState(null)
  const [commandNotice, setCommandNotice] = useState(null)
  const [openGroup, setOpenGroup] = useState('')
  const [reportMode, setReportMode] = useState('')
  const [reportText, setReportText] = useState('')
  const [reportNotice, setReportNotice] = useState(null)
  const [reports, setReports] = useState([])
  const [savingReport, setSavingReport] = useState(false)
  const [loadingReports, setLoadingReports] = useState(false)
  const [editingReport, setEditingReport] = useState(null)
  const [deletingReport, setDeletingReport] = useState(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState('')
  const today = useMemo(() => berlinDateKey(), [])
  const [reportDate, setReportDate] = useState(today)

  const loadOverview = useCallback(async () => {
    try {
      const scheduleData = await apiJson(`/api/schedule-v2?resource=entries&from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}`)
      setSchedule(Array.isArray(scheduleData.entries) ? scheduleData.entries : [])
      setOverviewNotice(null)
    } catch (error) {
      setOverviewNotice({ tone: 'error', text: error.message || 'Der heutige Dienstplan konnte nicht geladen werden.' })
    }

    if (!isAdmin) return
    try {
      const liveData = await apiJson(`/api/attendance?resource=live&date=${encodeURIComponent(today)}`)
      setLiveAttendance(Array.isArray(liveData.entries) ? liveData.entries : [])
      setCommandNotice(null)
    } catch (error) {
      setCommandNotice(error.message || 'Die Einsatz-Zentrale konnte nicht vollständig geladen werden.')
    }
  }, [isAdmin, today])

  useEffect(() => { loadOverview() }, [loadOverview])

  const groups = useMemo(() => buildDeploymentGroups(schedule, liveAttendance, today), [schedule, liveAttendance, today])
  const todayShifts = useMemo(() => schedule.filter((entry) => entry?.date === today && entry?.status !== 'draft'), [schedule, today])

  const loadReports = useCallback(async (date) => {
    setLoadingReports(true)
    try {
      const data = await apiJson(`/api/daily-reports?date=${encodeURIComponent(date)}`)
      setReports(Array.isArray(data.reports) ? data.reports : [])
    } catch (error) {
      setReports([])
      setReportNotice({ tone: 'error', text: error.message || 'Die Berichte konnten nicht geladen werden.' })
    } finally { setLoadingReports(false) }
  }, [])

  const closeReportDialog = useCallback(() => {
    setReportMode('')
    setEditingReport(null)
    setDeletingReport(null)
    setReportText('')
    setReportNotice(null)
  }, [])

  const openCompose = () => {
    setEditingReport(null)
    setDeletingReport(null)
    setReportText('')
    setReportNotice(null)
    setReportMode('compose')
  }

  const openHistory = async () => {
    setEditingReport(null)
    setDeletingReport(null)
    setReportMode('history')
    setReportNotice(null)
    await loadReports(reportDate)
  }

  const saveReport = async () => {
    const words = countReportWords(reportText)
    if (!words || words > MAX_REPORT_WORDS) return
    setSavingReport(true)
    setReportNotice(null)
    try {
      await apiJson('/api/daily-reports', { method: 'POST', body: JSON.stringify({ text: reportText }) })
      setReportText('')
      setReportNotice({ tone: 'success', text: 'Der Tagesbericht wurde gespeichert.' })
    } catch (error) {
      setReportNotice({ tone: 'error', text: error.message || 'Der Tagesbericht konnte nicht gespeichert werden.' })
    } finally { setSavingReport(false) }
  }

  const startEditReport = (report) => {
    setEditingReport(report)
    setDeletingReport(null)
    setReportText(report.text || '')
    setReportNotice(null)
    setReportMode('edit')
  }

  const saveEditedReport = async () => {
    const words = countReportWords(reportText)
    if (!editingReport || !words || words > MAX_REPORT_WORDS) return
    setSavingReport(true)
    setReportNotice(null)
    try {
      await apiJson(`/api/daily-reports?id=${encodeURIComponent(editingReport.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: reportText }),
      })
      setEditingReport(null)
      setReportText('')
      setReportMode('history')
      await loadReports(reportDate)
      setReportNotice({ tone: 'success', text: 'Der Tagesbericht wurde bearbeitet.' })
    } catch (error) {
      setReportNotice({ tone: 'error', text: error.message || 'Der Tagesbericht konnte nicht bearbeitet werden.' })
    } finally { setSavingReport(false) }
  }

  const changeReportDate = async (date) => {
    if (!date) return
    setReportDate(date)
    setDeletingReport(null)
    setReportNotice(null)
    await loadReports(date)
  }

  const confirmDeleteReport = async () => {
    if (!deletingReport) return
    setDeletingBusy(true)
    setReportNotice(null)
    try {
      await apiJson(`/api/daily-reports?id=${encodeURIComponent(deletingReport.id)}`, { method: 'DELETE' })
      setDeletingReport(null)
      await loadReports(reportDate)
      setReportNotice({ tone: 'success', text: 'Der Tagesbericht wurde endgültig gelöscht.' })
    } catch (error) {
      setReportNotice({ tone: 'error', text: error.message || 'Der Tagesbericht konnte nicht gelöscht werden.' })
    } finally { setDeletingBusy(false) }
  }

  const downloadReportPdf = async (report) => {
    setDownloadingReport(report.id)
    setReportNotice(null)
    try {
      await downloadPdf(`/api/daily-reports-pdf?id=${encodeURIComponent(report.id)}`)
    } catch (error) {
      setReportNotice({ tone: 'error', text: error.message || 'Die PDF konnte nicht heruntergeladen werden.' })
    } finally { setDownloadingReport('') }
  }

  const downloadDayPdf = async () => {
    if (!reports.length) return
    setDownloadingReport('day')
    setReportNotice(null)
    try {
      await downloadPdf(`/api/daily-reports-pdf?date=${encodeURIComponent(reportDate)}`)
    } catch (error) {
      setReportNotice({ tone: 'error', text: error.message || 'Die Tages-PDF konnte nicht heruntergeladen werden.' })
    } finally { setDownloadingReport('') }
  }

  return <div className="admin-overview-page">
    {overviewNotice && <div className={`admin-overview-notice ${overviewNotice.tone}`}>{overviewNotice.text}</div>}

    {isAdmin && <section className="admin-command-center" aria-labelledby="admin-command-center-title">
      <div className="admin-section-heading">
        <span className="admin-section-icon"><Icon name="shield" /></span>
        <div className="admin-section-copy">
          <div className="admin-section-title-row"><h2 id="admin-command-center-title">Einsatz-Zentrale</h2><span className="admin-only-badge">Nur für Admin</span></div>
          <p>Einsätze und Personalstatus des heutigen Tages auf einen Blick.</p>
        </div>
      </div>
      {commandNotice && <div className="command-center-warning">{commandNotice}</div>}
      <div className="deployment-status-list">
        <StatusRow id="working" label="Im Dienst" tone="working" entries={groups.working} open={openGroup === 'working'} onToggle={() => setOpenGroup((value) => value === 'working' ? '' : 'working')} />
        <StatusRow id="paused" label="In Pause" tone="paused" entries={groups.paused} open={openGroup === 'paused'} onToggle={() => setOpenGroup((value) => value === 'paused' ? '' : 'paused')} />
        <StatusRow id="not-started" label="Noch nicht gestartet" tone="not-started" entries={groups.notStarted} open={openGroup === 'not-started'} onToggle={() => setOpenGroup((value) => value === 'not-started' ? '' : 'not-started')} />
        <StatusRow id="completed" label="Dienst beendet" tone="completed" entries={groups.completed} open={openGroup === 'completed'} onToggle={() => setOpenGroup((value) => value === 'completed' ? '' : 'completed')} />
      </div>
    </section>}

    {isAdmin && <section className="daily-report-card" aria-labelledby="daily-report-card-title">
      <div className="admin-section-heading">
        <span className="admin-section-icon"><Icon name="file" /></span>
        <div className="admin-section-copy"><h2 id="daily-report-card-title">Tagesbericht</h2><p>Bericht schreiben, verwalten und professionell als PDF herunterladen.</p></div>
      </div>
      <div className="daily-report-actions">
        <button type="button" className="daily-report-action primary" onClick={openCompose}><Icon name="pencil" /><span>Bericht schreiben</span></button>
        <button type="button" className="daily-report-action secondary" onClick={openHistory}><Icon name="folder" /><span>Berichte öffnen</span></button>
      </div>
      <div className="daily-report-auto"><Icon name="info" /><span>Name, Datum und Uhrzeit werden automatisch gespeichert. Änderungen werden nachvollziehbar dokumentiert.</span></div>
    </section>}

    <section className="admin-quick-actions" aria-label="Schnellzugriff">
      <button type="button" className="admin-quick-card" onClick={() => navigate('attendance')}>
        <span className="admin-quick-icon"><Icon name="clock" /></span>
        <span className="admin-quick-copy"><strong>Digitale Zeiterfassung</strong><small>Arbeitszeit und Pausen erfassen</small></span>
        <span className="admin-quick-arrow" aria-hidden="true">›</span>
      </button>
      <button type="button" className="admin-quick-card" onClick={() => navigate('schedule')}>
        <span className="admin-quick-icon"><Icon name="calendar" /></span>
        <span className="admin-quick-copy"><strong>Dienstplan</strong><small>Dienste ansehen oder planen</small></span>
        <span className="admin-quick-arrow" aria-hidden="true">›</span>
      </button>
    </section>

    <section className="admin-today-card" aria-labelledby="admin-today-title">
      <header className="admin-today-header"><div><Icon name="calendar" /><h2 id="admin-today-title">Heute</h2></div><span>{formatTodayLabel(today)}</span></header>
      {todayShifts.length ? <div className="admin-today-list">{todayShifts.map((shift) => (
        <article className="admin-today-shift" key={shift.id || `${shift.employeeUserId}-${shift.start}-${shift.end}`}>
          <div className="admin-today-person"><span className="admin-today-avatar">{String(shift.employeeName || session.fullName || 'M').slice(0, 1).toUpperCase()}</span><div><strong>{shift.employeeName || session.fullName || 'Mitarbeiter'}</strong><small>{[shift.location, shift.workArea].filter(Boolean).join(' · ') || 'Einsatz'}</small></div></div>
          <div className="admin-today-time"><strong>{shift.start || '–'}–{shift.end || '–'}</strong><small>{Number(shift.pauseMinutes || 0)} Min. Pause</small></div>
        </article>
      ))}</div> : <div className="admin-today-empty"><Icon name="users" /><span>Für heute ist noch kein Dienst eingetragen.</span></div>}
    </section>

    {reportMode && isAdmin && <DailyReportDialog
      mode={reportMode}
      onClose={closeReportDialog}
      reportText={reportText}
      setReportText={setReportText}
      onSave={reportMode === 'edit' ? saveEditedReport : saveReport}
      saving={savingReport}
      notice={reportNotice}
      reports={reports}
      loadingReports={loadingReports}
      reportDate={reportDate}
      onDateChange={changeReportDate}
      onDayPdf={downloadDayPdf}
      onReportPdf={downloadReportPdf}
      downloadingReport={downloadingReport}
      onEdit={startEditReport}
      onDelete={(report) => { setDeletingReport(report); setReportNotice(null) }}
      deletingReport={deletingReport}
      onCancelDelete={() => setDeletingReport(null)}
      onConfirmDelete={confirmDeleteReport}
      deletingBusy={deletingBusy}
    />}
  </div>
}
