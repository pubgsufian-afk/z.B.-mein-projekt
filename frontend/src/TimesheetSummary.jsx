import { useMemo } from 'react'
import { summarizeTimesheetRows } from './timesheet-utils.js'

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} Std.`
}

export function TimesheetSummary({ rows = [] }) {
  const summary = useMemo(() => summarizeTimesheetRows(rows), [rows])
  const { total } = summary

  return <section className="panel timesheet-overview">
    <div className="page-heading"><div><h2>Stundenübersicht</h2><p>Arbeitstage und Gesamtstunden direkt im Portal – ohne PDF oder Excel.</p></div></div>
    <div className="metric-strip timesheet-overview-metrics" aria-label="Gesamtsummen im Zeitraum">
      <div><span>Mitarbeiter</span><strong>{total.employees}</strong></div>
      <div><span>{total.employees === 1 ? 'Arbeitstage' : 'Mitarbeiter-Tage'}</span><strong>{total.workDays}</strong></div>
      <div><span>Schichten</span><strong>{total.shifts}</strong></div>
      <div><span>Gesamtstunden</span><strong>{formatDuration(total.minutes)}</strong></div>
    </div>

    {summary.employees.length ? <div className="timesheet-employee-summaries" role="list" aria-label="Summen je Mitarbeiter">
      {summary.employees.map((item) => <article key={item.userId || `unregistered-${item.employeeName}`} role="listitem">
        <div className="timesheet-summary-name"><strong>{item.employeeName}</strong><span>{item.workDays} {item.workDays === 1 ? 'Arbeitstag' : 'Arbeitstage'} · {item.shifts} {item.shifts === 1 ? 'Schicht' : 'Schichten'}</span></div>
        <div><span>Pausen</span><strong>{formatDuration(item.pauseMinutes)}</strong></div>
        <div><span>Gesamtstunden</span><strong>{formatDuration(item.minutes)}</strong></div>
      </article>)}
    </div> : <div className="timesheet-empty">Für diesen Zeitraum sind noch keine abgeschlossenen Stunden vorhanden.</div>}
  </section>
}

export function TimesheetPagination({ page, pageSize, totalRows, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const first = totalRows ? (safePage - 1) * pageSize + 1 : 0
  const last = Math.min(totalRows, safePage * pageSize)

  return <div className="timesheet-pagination" aria-label="Seitennavigation">
    <span>{first}–{last} von {totalRows} Einträgen</span>
    <label>Einträge pro Seite<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
    <div>
      <button className="secondary-button compact" type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Zurück</button>
      <strong>Seite {safePage} von {totalPages}</strong>
      <button className="secondary-button compact" type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>Weiter</button>
    </div>
  </div>
}
