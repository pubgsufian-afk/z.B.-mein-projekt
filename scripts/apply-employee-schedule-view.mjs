import { readFile, writeFile } from 'node:fs/promises'

async function edit(path, transform) {
  const before = await readFile(path, 'utf8')
  const after = transform(before)
  if (after === before) throw new Error(`Keine Änderung erzeugt: ${path}`)
  await writeFile(path, after)
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: erwartet 1 Treffer, gefunden ${count}`)
  return source.replace(before, after)
}

await edit('frontend/src/App.jsx', (input) => {
  let source = input
  source = replaceOnce(
    source,
    "  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager'] },",
    "  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager', 'employee'] },",
    'Mitarbeiter-Dienstplan-Navigation',
  )

  source = replaceOnce(
    source,
`  if (session.role === 'employee') {
    return (
      <div className="employee-kiosk-shell">
        <header className="employee-kiosk-header">
          <Brand />
          <button className="secondary-button compact" type="button" onClick={onLogout}>Abmelden</button>
        </header>
        <main className="employee-kiosk-main" aria-label="Mitarbeiter-Zeiterfassung">{children}</main>
      </div>
    )
  }`,
`  if (session.role === 'employee') {
    return (
      <div className="employee-kiosk-shell">
        <header className="employee-kiosk-header">
          <Brand />
          <button className="secondary-button compact" type="button" onClick={onLogout}>Abmelden</button>
        </header>
        <nav className="employee-kiosk-nav" aria-label="Mitarbeiterbereiche">
          <button type="button" className={page === 'attendance' ? 'active' : ''} onClick={() => navigate('attendance')}>Stempeluhr</button>
          <button type="button" className={page === 'schedule' ? 'active' : ''} onClick={() => navigate('schedule')}>Dienstplan</button>
        </nav>
        <main className="employee-kiosk-main" aria-label={page === 'schedule' ? 'Eigener Dienstplan' : 'Mitarbeiter-Zeiterfassung'}>{children}</main>
      </div>
    )
  }`,
    'Mitarbeiter-Kiosk-Navigation',
  )

  source = replaceOnce(
    source,
`      const calls = [apiJson(\`/api/schedule-v2?resource=entries&from=\${from}&to=\${to}\`), apiJson('/api/schedule-v2?resource=objects')]
      if (management) calls.push(apiJson('/api/registrations'))
      const [shiftData, objectData, employeeData] = await Promise.all(calls)
      setEntries(shiftData.entries || [])
      setObjects(objectData.objects || [])
      setEmployees(employeeData?.employees || [])`,
`      const calls = [apiJson(\`/api/schedule-v2?resource=entries&from=\${from}&to=\${to}\`)]
      if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson('/api/registrations'))
      const [shiftData, objectData, employeeData] = await Promise.all(calls)
      setEntries(shiftData.entries || [])
      setObjects(objectData?.objects || [])
      setEmployees(employeeData?.employees || [])`,
    'Dienstplan-Ladevorgang nach Rolle',
  )

  source = replaceOnce(
    source,
`  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))`,
`  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week])
  const visibleEntries = useMemo(() => management
    ? entries
    : entries.filter((entry) => entry.employeeUserId === session.userId && entry.status === 'published'), [entries, management, session.userId])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))`,
    'Clientseitige Eigendienstplan-Begrenzung',
  )

  source = replaceOnce(
    source,
`    <Notice notice={notice} onClose={() => setNotice(null)} />
    <section className="panel schedule-toolbar">`,
`    <Notice notice={notice} onClose={() => setNotice(null)} />
    {!management && <section className="panel employee-schedule-intro"><PageHeader title="Mein Dienstplan" subtitle="Hier siehst du ausschließlich deine freigegebenen Dienste." /></section>}
    <section className="panel schedule-toolbar">`,
    'Eigener Dienstplan Überschrift',
  )

  source = replaceOnce(source, 'const dayEntries = entries.filter((entry) => entry.date === date);', 'const dayEntries = visibleEntries.filter((entry) => entry.date === date);', 'Sichtbare Dienstplan-Einträge')
  source = replaceOnce(
    source,
    '<button className="shift-item" key={entry.id} onClick={() => management && edit(entry)}>',
    '<button type="button" className="shift-item" key={entry.id} aria-disabled={!management} tabIndex={management ? 0 : -1} onClick={() => management && edit(entry)}>',
    'Schreibgeschützter Mitarbeiter-Dienst',
  )
  source = replaceOnce(source, '<span>{entry.employeeName}</span>', '{management && <span>{entry.employeeName}</span>}', 'Mitarbeitername im Eigendienstplan ausblenden')
  return source
})

await edit('frontend/src/styles.css', (input) => `${input.trimEnd()}

/* Mitarbeiter dürfen zusätzlich nur ihren eigenen Dienstplan lesen. */
.employee-kiosk-nav {
  width: min(100%, 760px);
  margin: 14px auto 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
}
.employee-kiosk-nav button {
  min-height: 46px;
  border: 0;
  border-radius: 9px;
  color: var(--muted);
  background: transparent;
  font-weight: 800;
}
.employee-kiosk-nav button.active {
  color: #181100;
  background: var(--gold);
}
.employee-kiosk-main .employee-schedule-intro { margin-top: 0; }
.employee-kiosk-main .schedule-toolbar { margin-top: 14px; }
.employee-kiosk-main .shift-item[aria-disabled="true"] { cursor: default; }
.employee-kiosk-main .shift-item[aria-disabled="true"]:hover { border-color: var(--border); transform: none; }

@media (max-width: 680px) {
  .employee-kiosk-nav { margin-top: 10px; }
  .employee-kiosk-main:has(.employee-schedule-intro) { padding-top: 12px; }
}
`)

await edit('netlify/functions/schedule-v2.mts', (input) => {
  let source = input
  source = replaceOnce(
    source,
`  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
  const url = new URL(request.url)

  if (request.method === 'GET') {
    const resource = url.searchParams.get('resource') || 'entries'
    if (resource === 'entries') return json({ entries: await getEntries(current, url) })
    if (resource === 'objects') {`,
`  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)
  const url = new URL(request.url)

  if (request.method === 'GET') {
    const resource = url.searchParams.get('resource') || 'entries'
    if (resource === 'entries') return json({ entries: await getEntries(current, url) })
    if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
    if (resource === 'objects') {`,
    'Eigener Dienstplan Serverfreigabe',
  )
  return source
})

await edit('scripts/employee-access-policy-test.mjs', (input) => {
  let source = input
  source = replaceOnce(
    source,
    "assert.match(app, /\\{ key: 'attendance', label: 'Zeiterfassung', roles: \\['owner', 'admin', 'manager', 'employee'\\] \\}/)",
    "assert.match(app, /\\{ key: 'attendance', label: 'Zeiterfassung', roles: \\['owner', 'admin', 'manager', 'employee'\\] \\}/)\nassert.match(app, /\\{ key: 'schedule', label: 'Dienstplan', roles: \\['owner', 'admin', 'manager', 'employee'\\] \\}/)",
    'Dienstplan-Navigationstest',
  )
  source = replaceOnce(source, "for (const key of ['overview', 'schedule', 'times', 'corrections']) {", "for (const key of ['overview', 'times', 'corrections']) {", 'Erlaubter Dienstplan im Sperrtest')
  source = replaceOnce(
    source,
    "assert.match(app, /employee-kiosk-shell/)",
    "assert.match(app, /employee-kiosk-shell/)\nassert.match(app, /employee-kiosk-nav/)\nassert.match(app, /entry\\.employeeUserId === session\\.userId && entry\\.status === 'published'/)",
    'Kiosk-Dienstplan-Quelltest',
  )
  source = replaceOnce(
    source,
    "assert.match(schedule, /if \\(!MANAGEMENT\\.has\\(current\\.role\\)\\) return json\\(\\{ message: 'Keine Berechtigung\\.' \\}, 403\\)/)",
    "assert.match(schedule, /resource === 'entries'[\\s\\S]*?getEntries\\(current, url\\)/)\nassert.match(schedule, /entry\\.employeeUserId === current\\.userId && entry\\.status === 'published'/)\nassert.match(schedule, /resource === 'entries'[\\s\\S]*?if \\(!MANAGEMENT\\.has\\(current\\.role\\)\\) return json\\(\\{ message: 'Keine Berechtigung\\.' \\}, 403\\)/)",
    'Serverseitiger Eigendienstplan-Test',
  )
  return source
})

await edit('scripts/unified-portal-test.mjs', (input) => replaceOnce(
  input,
  "assert.match(app, /employee-kiosk-shell/)",
  "assert.match(app, /employee-kiosk-shell/)\nassert.match(app, /employee-kiosk-nav/)\nassert.match(app, /Mein Dienstplan/)",
  'Allgemeiner Eigendienstplan-Test',
))

await edit('tests/e2e/unified-portal.spec.mjs', (input) => {
  let source = input
  source = replaceOnce(
    source,
`  const schedule = {
    id: 'shift-1', employeeUserId: 'employee-anna', employeeName: 'Anna Beispiel', date: new Date().toISOString().slice(0, 10),
    start: '07:00', end: '17:00', pauseMinutes: 30, objectId: 'site-nord', location: 'Objekt Nord', workArea: 'Zutrittskontrolle', status: 'published', version: 1,
  }`,
`  const schedule = {
    id: 'shift-1', employeeUserId: 'employee-anna', employeeName: 'Anna Beispiel', date: new Date().toISOString().slice(0, 10),
    start: '07:00', end: '17:00', pauseMinutes: 30, objectId: 'site-nord', location: 'Objekt Nord', workArea: 'Zutrittskontrolle', status: 'published', version: 1,
  }
  const otherSchedule = {
    id: 'shift-2', employeeUserId: 'employee-bernd', employeeName: 'Bernd Muster', date: new Date().toISOString().slice(0, 10),
    start: '08:00', end: '16:00', pauseMinutes: 30, objectId: 'site-sued', location: 'Objekt Süd', workArea: 'Empfang', status: 'published', version: 1,
  }
  const schedules = [schedule, otherSchedule]`,
    'Zweiter Mitarbeiterdienst im Browsertest',
  )
  source = replaceOnce(
    source,
    "      const visible = role === 'employee' ? [schedule] : [schedule]",
    "      const visible = role === 'employee' ? schedules.filter((entry) => entry.employeeUserId === 'employee-anna' && entry.status === 'published') : schedules",
    'Eigendienstplan im API-Mock',
  )

  const start = source.indexOf("test('employee sees only the kiosk clock and no portal data'")
  if (start < 0) throw new Error('Mitarbeiter-Browsertest nicht gefunden.')
  source = source.slice(0, start) + `test('employee sees only clock and own published schedule', async ({ page }, testInfo) => {
  await login(page, 'employee')
  await expect(page.locator('.employee-kiosk-shell')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Habun Security' })).toBeVisible()
  const brandMark = page.locator('.employee-kiosk-header .brand-mark')
  await expect(brandMark).toBeVisible()
  const brandBox = await brandMark.boundingBox()
  expect(brandBox?.width || 0).toBeGreaterThanOrEqual(70)
  expect(brandBox?.height || 0).toBeGreaterThanOrEqual(70)
  await expect(page.getByRole('button', { name: 'Menü öffnen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stempeluhr', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dienstplan', exact: true })).toBeVisible()
  await expect(page.getByText(/Übersicht|Heutiger Dienst|Meine Zeiten|Zeiten|Korrekturen|Berichte|PDF|Excel|Gesamt|Heutige Buchungen/i)).toHaveCount(0)
  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/05-mitarbeiter-stempeluhr-iphone.png', fullPage: true })
  if (testInfo.project.name === 'android-chromium') await page.screenshot({ path: 'artifacts/unified-preview/06-mitarbeiter-stempeluhr-android.png', fullPage: true })

  await page.getByRole('button', { name: 'Dienstplan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mein Dienstplan', exact: true })).toBeVisible()
  await expect(page.getByText('Objekt Nord', { exact: false })).toBeVisible()
  await expect(page.getByText('Zutrittskontrolle', { exact: false })).toBeVisible()
  await expect(page.getByText('Objekt Süd', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Bernd Muster', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Dienst am .* hinzufügen/ })).toHaveCount(0)
  await expect(page.getByText(/Vorwoche kopieren|Entwurf prüfen und freigeben|Dienst erstellen|Als Entwurf speichern/i)).toHaveCount(0)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/07-mitarbeiter-dienstplan-iphone.png', fullPage: true })
  if (testInfo.project.name === 'android-chromium') await page.screenshot({ path: 'artifacts/unified-preview/08-mitarbeiter-dienstplan-android.png', fullPage: true })
  await expectNoHorizontalPageOverflow(page)

  await page.getByRole('button', { name: 'Stempeluhr', exact: true }).click()
  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)
  await page.getByRole('button', { name: /Arbeit beginnen/ }).click()
  await expect(page.getByText('Arbeitszeit läuft', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Pause beginnen' }).click()
  await expect(page.getByText('Pause läuft', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Pause beenden' }).click()
  await page.getByRole('button', { name: 'Arbeit beenden' }).click()
  await expect(page.getByText('Dienst abgeschlossen', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()
  await expectNoHorizontalPageOverflow(page)
})
`
  return source
})

console.log('Employee own-schedule view applied')
