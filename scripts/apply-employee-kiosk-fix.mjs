import { readFile, writeFile } from 'node:fs/promises'

async function edit(path, transform) {
  const before = await readFile(path, 'utf8')
  const after = transform(before)
  if (after === before) throw new Error(`Keine Änderung erzeugt: ${path}`)
  await writeFile(path, after)
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Erwarteter Abschnitt fehlt: ${label}`)
  return source.replace(before, after)
}

function replacePattern(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Erwartetes Muster fehlt: ${label}`)
  return source.replace(pattern, replacement)
}

await edit('frontend/src/App.jsx', (input) => {
  let source = input
  source = replaceExact(source, `const NAVIGATION = [
  { key: 'overview', label: 'Übersicht', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'attendance', label: 'Zeiterfassung', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'employees', label: 'Mitarbeiter', roles: ['owner', 'admin', 'manager'] },
  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'times', label: 'Meine Zeiten', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'corrections', label: 'Korrekturen', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
]`, `const NAVIGATION = [
  { key: 'overview', label: 'Übersicht', roles: ['owner', 'admin', 'manager'] },
  { key: 'attendance', label: 'Zeiterfassung', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'employees', label: 'Mitarbeiter', roles: ['owner', 'admin', 'manager'] },
  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager'] },
  { key: 'times', label: 'Zeiten', roles: ['owner', 'admin', 'manager'] },
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'corrections', label: 'Korrekturen', roles: ['owner', 'admin', 'manager'] },
  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
]`, 'Navigation')

  source = replaceExact(source, `function Brand({ compact = false }) {
  return (
    <div className={\`brand \${compact ? 'brand-compact' : ''}\`}>
      <img src="/habun-logo.png" alt="Habun Security" />
      {!compact && <div><strong>Habun Security</strong><span>Mitarbeiterportal</span></div>}
    </div>
  )
}`, `function Brand({ compact = false }) {
  return (
    <div className={\`brand \${compact ? 'brand-compact' : ''}\`}>
      <span className="brand-mark"><img src="/habun-logo.png" alt="Habun Security" /></span>
      {!compact && <div><strong>Habun Security</strong><span>Mitarbeiterportal</span></div>}
    </div>
  )
}`, 'Brand')

  source = replaceExact(source, `  const title = items.find((item) => item.key === page)?.label || 'Übersicht'
  const navigate = (key) => { setPage(key); setDrawer(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return (`, `  const title = items.find((item) => item.key === page)?.label || 'Übersicht'
  const navigate = (key) => { setPage(key); setDrawer(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (session.role === 'employee') {
    return (
      <div className="employee-kiosk-shell">
        <header className="employee-kiosk-header">
          <Brand />
          <button className="secondary-button compact" type="button" onClick={onLogout}>Abmelden</button>
        </header>
        <main className="employee-kiosk-main" aria-label="Mitarbeiter-Zeiterfassung">{children}</main>
      </div>
    )
  }

  return (`, 'Mitarbeiter-Kiosk-Shell')

  source = replaceExact(source, `          <button className="hamburger-button" type="button" aria-label="Menü öffnen" onClick={() => setDrawer(true)}><span /><span /><span /></button>
          <div className="topbar-title">`, `          <button className="hamburger-button" type="button" aria-label="Menü öffnen" onClick={() => setDrawer(true)}><span /><span /><span /></button>
          <div className="topbar-logo" aria-hidden="true"><Brand compact /></div>
          <div className="topbar-title">`, 'Mobiles Topbar-Logo')

  source = replaceExact(source, `function AttendancePage({ session }) {
  const [now, setNow] = useState(new Date())`, `function AttendancePage({ session }) {
  const employeeOnly = session.role === 'employee'
  const [now, setNow] = useState(new Date())`, 'Employee-Flag')

  source = replaceExact(source, `    <section className="attendance-hero">
      <DigitalClock now={now} />
      <div className="attendance-shift">
        <span>Heutiger Dienst</span>
        <strong>{state.schedule ? \`\${state.schedule.start || '–'}–\${state.schedule.end || '–'}\` : 'Kein Dienst veröffentlicht'}</strong>
        <p>{state.schedule ? \`\${state.schedule.location || '–'} · \${state.schedule.workArea || '–'}\` : 'Der Dienstplan wurde für heute noch nicht freigegeben.'}</p>
        <div className="attendance-state"><span className={\`state-light \${phase}\`} />{phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'}</div>
      </div>
    </section>`, `    <section className={\`attendance-hero \${employeeOnly ? 'employee-attendance-hero' : ''}\`}>
      <DigitalClock now={now} />
      <div className="attendance-shift">
        {employeeOnly ? <>
          <span>Arbeitsstatus</span>
          <strong>{phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'}</strong>
          <p>Hier kannst du ausschließlich deine Arbeitszeit und Pause bedienen.</p>
        </> : <>
          <span>Heutiger Dienst</span>
          <strong>{state.schedule ? \`\${state.schedule.start || '–'}–\${state.schedule.end || '–'}\` : 'Kein Dienst veröffentlicht'}</strong>
          <p>{state.schedule ? \`\${state.schedule.location || '–'} · \${state.schedule.workArea || '–'}\` : 'Der Dienstplan wurde für heute noch nicht freigegeben.'}</p>
        </>}
        <div className="attendance-state"><span className={\`state-light \${phase}\`} />{phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'}</div>
      </div>
    </section>`, 'Mitarbeiter-Zeiterfassungsansicht')

  source = replaceExact(source, `      <PageHeader title="Zeit bedienen" subtitle="Der Standort wird nur bei Arbeitsbeginn und Arbeitsende abgefragt." />`, `      <PageHeader title={employeeOnly ? 'Stempeluhr' : 'Zeit bedienen'} subtitle={employeeOnly ? 'Arbeitsbeginn, Pause und Arbeitsende.' : 'Der Standort wird nur bei Arbeitsbeginn und Arbeitsende abgefragt.'} />`, 'Stempeluhr-Überschrift')

  source = replaceExact(source, `{phase === 'completed' && <div className="completed-card"><strong>Dienst abgeschlossen</strong><span>Arbeitsbeginn {formatDateTime(state.clockInAt)} · Arbeitsende {formatDateTime(state.clockOutAt)}</span></div>}`, `{phase === 'completed' && <div className="completed-card"><strong>Dienst abgeschlossen</strong>{!employeeOnly && <span>Arbeitsbeginn {formatDateTime(state.clockInAt)} · Arbeitsende {formatDateTime(state.clockOutAt)}</span>}</div>}`, 'Abgeschlossene Zeitdetails')

  source = replaceExact(source, `    <section className="panel">
      <PageHeader title="Heutige Buchungen"`, `    {!employeeOnly && <section className="panel">
      <PageHeader title="Heutige Buchungen"`, 'Buchungsliste ausblenden')
  source = replaceExact(source, `    </section>
    {MANAGEMENT.has(session.role) && <section className="panel"><PageHeader title="Live-Übersicht"`, `    </section>}
    {MANAGEMENT.has(session.role) && <section className="panel"><PageHeader title="Live-Übersicht"`, 'Buchungsliste schließen')

  source = replaceExact(source, `function UnifiedPortal({ session, onLogout }) {
  const allowed = NAVIGATION.filter((item) => item.roles.includes(session.role)).map((item) => item.key)
  const [page, setPage] = useState('overview')
  useEffect(() => { if (!allowed.includes(page)) setPage('overview') }, [allowed, page])`, `function UnifiedPortal({ session, onLogout }) {
  const allowed = NAVIGATION.filter((item) => item.roles.includes(session.role)).map((item) => item.key)
  const initialPage = session.role === 'employee' ? 'attendance' : 'overview'
  const [page, setPage] = useState(initialPage)
  useEffect(() => { if (!allowed.includes(page)) setPage(initialPage) }, [allowed, initialPage, page])`, 'Startseite nach Rolle')

  return source
})

await edit('frontend/src/styles.css', (input) => `${input.trimEnd()}

/* Strenger Mitarbeiter-Kiosk und mobile Safe-Area-Korrekturen */
html, body, #root { min-height: 100%; }
body { min-height: 100dvh; }
.brand-mark { display: grid; place-items: center; flex: 0 0 auto; width: 72px; height: 78px; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-2); }
.brand-mark img, .brand img { width: 64px; height: 70px; object-fit: contain; filter: none; }
.brand-compact .brand-mark { width: 52px; height: 56px; border-radius: 11px; }
.brand-compact .brand-mark img { width: 46px; height: 50px; }
.topbar-logo { display: none; flex: 0 0 auto; }
.app-main { padding-bottom: calc(50px + env(safe-area-inset-bottom)); }
.topbar { min-height: calc(104px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top); }
.sidebar { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
.auth-form-panel, .pending-page, .loading-screen { padding-top: max(24px, env(safe-area-inset-top)); padding-bottom: max(24px, env(safe-area-inset-bottom)); }
.employee-kiosk-shell { min-height: 100dvh; padding: max(18px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--bg); }
.employee-kiosk-header { width: min(100%, 760px); min-height: 92px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); }
.employee-kiosk-main { width: min(100%, 760px); margin: 0 auto; padding: 22px 0 8px; }
.employee-kiosk-main .attendance-hero { grid-template-columns: 1fr; }
.employee-kiosk-main .attendance-shift { min-height: 150px; }
.employee-kiosk-main .attendance-controls-panel { margin-top: 18px; }
.employee-kiosk-main .clock-actions { grid-template-columns: 1fr; }
.employee-kiosk-main .clock-button { min-height: 118px; }
.employee-kiosk-main .notice { margin-inline: 0; }

@media (max-width: 900px) {
  .topbar { min-height: calc(82px + env(safe-area-inset-top)); }
  .topbar-logo { display: block; }
  .topbar-logo .brand-mark { width: 44px; height: 48px; border: 0; background: transparent; }
  .topbar-logo .brand-mark img { width: 42px; height: 46px; }
  .sidebar { height: 100dvh; }
  .sidebar nav { min-height: 0; overscroll-behavior: contain; }
  .app-main { padding-bottom: calc(42px + env(safe-area-inset-bottom)); }
}

@media (max-width: 680px) {
  .employee-kiosk-header { min-height: 84px; }
  .employee-kiosk-header .brand > div { display: none; }
  .employee-kiosk-header .brand-mark { width: 60px; height: 66px; }
  .employee-kiosk-header .brand-mark img { width: 54px; height: 60px; }
  .employee-kiosk-main { padding-top: 16px; }
  .employee-kiosk-main .digital-clock-wrap { min-height: 190px; }
  .employee-kiosk-main .attendance-shift { min-height: 135px; }
  .employee-kiosk-main .page-heading { min-height: auto; }
}

@media (display-mode: standalone) {
  .employee-kiosk-shell, .app-shell { min-height: 100dvh; }
}
`)

await edit('netlify/functions/_shared/attendance-service.mts', (input) => replaceExact(input, `    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {
      const current = requireActor(actor)
      const userId = MANAGEMENT_ROLES.has(current.role) ? normalizedText(filters.userId) : current.userId
      return { entries: await repository.listHistory({ userId, from: normalizedText(filters.from), to: normalizedText(filters.to) }) }
    },`, `    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {
      const current = requireActor(actor)
      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')
      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }
    },`, 'Attendance-History-Rolle'))

await edit('netlify/functions/attendance.mts', (input) => {
  let source = input
  source = replacePattern(source, /async function fetchScheduleEndpoint[\s\S]*?\n}\n\nfunction schedulePayload/, `async function loadSchedules(): Promise<ScheduleEntry[]> {
  const { getStore } = await import('@netlify/blobs')
  const scheduleStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await scheduleStore.list({ prefix: 'shifts/' })
  const rows = await Promise.all(listed.blobs.map((blob) => scheduleStore.get(blob.key, { type: 'json' }) as Promise<ScheduleEntry | null>))
  return rows.filter((entry): entry is ScheduleEntry => Boolean(entry))
}

function schedulePayload`, 'Direkter Dienstplan-Store')
  source = source.replaceAll('loadSchedules(request)', 'loadSchedules()')
  source = replaceExact(source, `        const state = await service.getState(actor)
        const schedules = await loadSchedules()`, `        const state = await service.getState(actor)
        if (actor.role === 'employee') return response({ phase: state.phase })
        const schedules = await loadSchedules()`, 'Mitarbeiter-State reduzieren')
  source = replaceExact(source, `      if (resource === 'history') {
        return response(await service.getHistory(actor, {`, `      if (resource === 'history') {
        if (actor.role === 'employee') return response({ message: 'Keine Berechtigung.', code: 'FORBIDDEN' }, 403)
        return response(await service.getHistory(actor, {`, 'History sperren')
  source = replaceExact(source, `    return response(await service.record(actor, safeBody), 201)`, `    const recorded = await service.record(actor, safeBody)
    return response(actor.role === 'employee' ? { saved: true, action: normalized.action } : recorded, 201)`, 'POST-Antwort reduzieren')
  return source
})

await edit('netlify/functions/attendance-maintenance.mts', (input) => replaceExact(input, `  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)`, `  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)`, 'Korrekturen nur Management'))

await edit('netlify/functions/schedule-v2.mts', (input) => replaceExact(input, `  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (current.role === 'pending') return json({ message: 'Das Konto ist noch nicht freigeschaltet.' }, 403)`, `  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)`, 'Dienstplan nur Management'))

await edit('netlify/functions/work.mts', (input) => {
  let source = input
  source = replaceExact(source, `  const url = new URL(request.url);
  const queryResource = url.searchParams.get("resource");

  if (request.method === "GET" && queryResource === "schedule") {
    const current = await currentPortalUser();`, `  const url = new URL(request.url);
  const queryResource = url.searchParams.get("resource");
  const currentAccess = await currentPortalUser();
  if (!currentAccess) return error("Nicht angemeldet.", 401);
  if (!MANAGEMENT_ROLES.includes(currentAccess.role)) return error("Keine Berechtigung.", 403);

  if (request.method === "GET" && queryResource === "schedule") {
    const current = currentAccess;`, 'Legacy-Work-Gateway')
  source = replaceExact(source, `  const current = await currentPortalUser();
  if (!current) return error("Nicht angemeldet.", 401);
  if (!MANAGEMENT_ROLES.includes(current.role)) return error("Keine Berechtigung.", 403);`, `  const current = currentAccess;`, 'Legacy-Work-POST')
  return source
})

await edit('tests/e2e/unified-portal.spec.mjs', (input) => {
  let source = input
  source = replaceExact(source, `  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()`, `  await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()`, 'Login-Zielseite')
  source = replacePattern(source, /test\('employee sees only personal operational pages and no administration'[\s\S]*?\n}\)\s*$/, `test('employee sees only the kiosk clock and no portal data', async ({ page }) => {
  await login(page, 'employee')
  await expect(page.locator('.employee-kiosk-shell')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Habun Security' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Menü öffnen' })).toHaveCount(0)
  await expect(page.getByText(/Übersicht|Dienstplan|Meine Zeiten|Zeiten|Korrekturen|Berichte|PDF|Excel|Gesamt|Heutige Buchungen/i)).toHaveCount(0)
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
`, 'Employee-E2E')
  return source
})

await edit('scripts/unified-portal-test.mjs', (input) => {
  let source = input
  source = replaceExact(source, `assert.match(styles, /week-cards/)`, `assert.match(styles, /week-cards/)
assert.match(app, /employee-kiosk-shell/)
assert.match(app, /brand-mark/)
assert.match(styles, /safe-area-inset-top/)
assert.match(styles, /safe-area-inset-bottom/)`, 'Unified-Kiosk-Assertions')
  return source
})

console.log('Employee kiosk refactor applied')
