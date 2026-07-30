const ACTION_LABELS = {
  started: 'Arbeitsbeginn',
  'break-started': 'Pause gestartet',
  'break-ended': 'Pause beendet',
  ended: 'Arbeitsende',
}

export function buildDailyRows(events) {
  const byDate = new Map()
  for (const event of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const row = byDate.get(event.date) || {
      date: event.date,
      start: '',
      end: '',
      pauseMinutes: 0,
      totalHours: 0,
      location: event.location || '',
      note: '',
    }
    const time = new Date(event.occurredAt)
    const displayTime = time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    if (event.action === 'started') row.start = displayTime
    if (event.action === 'ended') row.end = displayTime
    if (event.note) row.note = event.note
    if (event.location) row.location = event.location
    byDate.set(event.date, row)
  }

  for (const [date, row] of byDate) {
    const dayEvents = events
      .filter((event) => event.date === date)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    let pauseStart = null
    let pauseMs = 0
    for (const event of dayEvents) {
      if (event.action === 'break-started') pauseStart = new Date(event.occurredAt)
      if (event.action === 'break-ended' && pauseStart) {
        pauseMs += new Date(event.occurredAt) - pauseStart
        pauseStart = null
      }
    }
    const start = dayEvents.find((event) => event.action === 'started')
    const end = [...dayEvents].reverse().find((event) => event.action === 'ended')
    row.pauseMinutes = Math.round(pauseMs / 60000)
    row.totalHours = start && end
      ? Math.max(0, (new Date(end.occurredAt) - new Date(start.occurredAt) - pauseMs) / 3600000)
      : 0
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function eventLabel(action) {
  return ACTION_LABELS[action] || action
}

export async function exportExcel({ rows, employee, month }) {
  const XLSX = await import('xlsx')
  const data = rows.map((row) => ({
    Datum: formatDate(row.date),
    Arbeitsbeginn: row.start,
    Pause: minutesLabel(row.pauseMinutes),
    Arbeitsende: row.end,
    Gesamtstunden: Number(row.totalHours.toFixed(2)),
    Einsatzort: row.location,
    Bemerkung: row.note,
  }))
  const sheet = XLSX.utils.json_to_sheet(data)
  sheet['!cols'] = [{ wch: 13 }, { wch: 16 }, { wch: 12 }, { wch: 15 }, { wch: 17 }, { wch: 22 }, { wch: 30 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Stundenzettel')
  XLSX.writeFile(book, `Stundenzettel-${safeName(employee.fullName)}-${month}.xlsx`)
}

export async function exportAllExcel({ reports, month }) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const overview = reports.map(({ employee, rows }) => {
    const total = rows.reduce((sum, row) => sum + row.totalHours, 0)
    return {
      Mitarbeiter: employee.fullName,
      Personalnummer: employee.employeeId,
      Firma: employee.company,
      Einsatzort: employee.location,
      Gesamtstunden: Number(total.toFixed(2)),
      Überstunden: Number((total - 160).toFixed(2)),
    }
  })
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(overview), 'Monatsübersicht')
  for (const { employee, rows } of reports) {
    const data = rows.map((row) => ({
      Datum: formatDate(row.date),
      Arbeitsbeginn: row.start,
      Pause: minutesLabel(row.pauseMinutes),
      Arbeitsende: row.end,
      Gesamtstunden: Number(row.totalHours.toFixed(2)),
      Einsatzort: row.location,
      Bemerkung: row.note,
    }))
    const name = `${String(employee.employeeId || '').slice(0, 8)} ${String(employee.fullName || '').slice(0, 18)}`.trim().slice(0, 31)
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data), name || 'Mitarbeiter')
  }
  XLSX.writeFile(book, `Habun-Monatsübersicht-${month}.xlsx`)
}

export async function exportPdf({ rows, employee, month }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Habun Security – Stundenzettel', 14, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Mitarbeiter: ${employee.fullName}`, 14, 24)
  doc.text(`Personalnummer: ${employee.employeeId || '—'}`, 14, 30)
  doc.text(`Monat: ${monthLabel(month)}`, 150, 24)
  doc.text(`Gesamtstunden: ${rows.reduce((sum, row) => sum + row.totalHours, 0).toFixed(2)}`, 150, 30)
  autoTable(doc, {
    startY: 38,
    head: [['Datum', 'Beginn', 'Pause', 'Ende', 'Stunden', 'Einsatzort', 'Bemerkung']],
    body: rows.map((row) => [
      formatDate(row.date),
      row.start,
      minutesLabel(row.pauseMinutes),
      row.end,
      row.totalHours.toFixed(2),
      row.location,
      row.note,
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [34, 40, 43], textColor: [239, 199, 94] },
    alternateRowStyles: { fillColor: [244, 244, 244] },
  })
  const signatureY = Math.min(190, (doc.lastAutoTable?.finalY || 60) + 24)
  doc.line(20, signatureY, 105, signatureY)
  doc.line(170, signatureY, 260, signatureY)
  doc.text('Datum / Unterschrift Mitarbeiter', 20, signatureY + 5)
  doc.text('Datum / Unterschrift Vorgesetzter', 170, signatureY + 5)
  doc.save(`Stundenzettel-${safeName(employee.fullName)}-${month}.pdf`)
}

export function minutesLabel(value) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}` : `0:${String(minutes).padStart(2, '0')}`
}

export function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('de-DE')
}

function monthLabel(value) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
}

function safeName(value) {
  return String(value || 'Mitarbeiter').trim().replace(/[^a-zA-Z0-9äöüÄÖÜß-]+/g, '-')
}
