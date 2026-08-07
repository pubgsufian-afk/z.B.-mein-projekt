import { test, expect } from '@playwright/test'

const users = {
  owner: { id: 'owner-1', email: 'owner@example.test', name: 'Hauptadmin Muster', role: 'owner' },
  admin: { id: 'admin-1', email: 'admin@example.test', name: 'Admin Muster', role: 'admin' },
  manager: { id: 'manager-1', email: 'manager@example.test', name: 'Einsatzleiter Muster', role: 'manager' },
  employee: { id: 'employee-anna', email: 'anna@example.test', name: 'Anna Muster', role: 'employee' },
}

async function mockIdentity(page, user) {
  await page.addInitScript((currentUser) => {
    const listeners = []
    const user = {
      id: currentUser.id,
      email: currentUser.email,
      user_metadata: { full_name: currentUser.name },
      app_metadata: { roles: [currentUser.role] },
      roles: [currentUser.role],
      role: currentUser.role,
      confirmed_at: new Date().toISOString(),
      token: { access_token: `test-${currentUser.role}-token` },
    }
    window.netlifyIdentity = {
      currentUser: () => user,
      on: (name, callback) => { listeners.push({ name, callback }); if (name === 'init') setTimeout(() => callback(user), 0) },
      off: () => {},
      open: () => {},
      close: () => {},
      login: async () => user,
      signup: async () => user,
      logout: async () => {},
      refresh: async () => user,
      user,
    }
    window.__HABUN_TEST_USER__ = user
  }, user)
}

async function mockLoggedOutIdentity(page, { signupSucceeds = false } = {}) {
  await page.addInitScript(({ signupSucceeds }) => {
    window.netlifyIdentity = {
      currentUser: () => null,
      on: (name, callback) => { if (name === 'init') setTimeout(() => callback(null), 0) },
      off: () => {},
      open: () => {},
      close: () => {},
      login: async () => { throw new Error('Login ist in diesem Test nicht aktiv.') },
      signup: async (_email, _password, metadata) => {
        if (!signupSucceeds) throw new Error('Signup ist in diesem Test nicht aktiv.')
        return { id: 'new-user', user_metadata: metadata }
      },
      logout: async () => {},
      refresh: async () => null,
    }
  }, { signupSucceeds })
}

async function mockPortalApis(page, role = 'admin') {
  const attendanceEvents = []
  const shifts = [
    { id: 'shift-anna', employeeUserId: 'employee-anna', employeeName: 'Anna Muster', date: '2026-08-10', start: '08:00', end: '16:00', pauseMinutes: 30, location: 'Objekt Nord', workArea: 'Zutrittskontrolle', status: 'published' },
    { id: 'shift-bernd', employeeUserId: 'employee-bernd', employeeName: 'Bernd Muster', date: '2026-08-10', start: '09:00', end: '17:00', pauseMinutes: 30, location: 'Objekt Süd', workArea: 'Empfang', status: 'published' },
  ]
  let company = { companyName: 'Habun Security', phone: '0511 123456', email: 'kontakt@habun-security.de', address: 'Hannover', logoUrl: '/habun-logo.png' }
  const registrations = [
    { userId: 'employee-anna', id: 'employee-anna', fullName: 'Anna Muster', email: 'anna@example.test', role: 'employee', status: 'active', location: 'Objekt Nord' },
    { userId: 'manager-1', id: 'manager-1', fullName: 'Einsatzleiter Muster', email: 'manager@example.test', role: 'manager', status: 'active', location: 'Objekt Nord' },
  ]
  const worksiteEntries = [{ id: 'site-nord', name: 'Objekt Nord', location: 'Objekt Nord', status: 'active' }]
  const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%Habun test PDF')
  const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = async (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/api/session') return json({ role, fullName: users[role]?.name || 'Admin Muster', email: users[role]?.email, userId: users[role]?.id, location: 'Objekt Nord', status: 'active' })
    if (path === '/api/registrations') return json({ employees: registrations, registrations: [] })
    if (path === '/api/settings') return method === 'GET' ? json(company) : json({ ok: true })
    if (path === '/api/company-settings') {
      if (method === 'GET') return json(company)
      company = { ...company, ...(JSON.parse(request.postData() || '{}')) }
      return json({ settings: company })
    }
    if (path === '/api/schedule-directory') return json({ employees: registrations })
    if (path === '/api/schedule-v2') {
      if (role === 'employee') return json({ entries: shifts.filter((shift) => shift.employeeUserId === users.employee.id), objects: worksiteEntries })
      return json({ entries: shifts, objects: worksiteEntries })
    }
    if (path === '/api/schedule-assist-v2') return json({ templates: [] })
    if (path === '/api/schedule-pdf') return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Habun-Dienstplan-2026-08-10.pdf"' }, body: Buffer.from(pdfBytes) })
    if (path === '/api/reports-v2') {
      const format = url.searchParams.get('format')
      if (format === 'xlsx') return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="Habun-Stundenzettel.xlsx"' }, body: Buffer.from(xlsxBytes) })
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Habun-Stundenzettel.pdf"' }, body: Buffer.from(pdfBytes) })
    }
    if (path === '/api/worksite-v2') return json({ objects: worksiteEntries })
    if (path === '/api/attendance') {
      if (method === 'GET') return json({ events: attendanceEvents, state: attendanceEvents.length ? 'working' : 'idle' })
      const body = JSON.parse(request.postData() || '{}')
      const labels = { 'clock-in': 'Arbeitszeit läuft', 'break-start': 'Pause läuft', 'break-end': 'Arbeitszeit läuft', 'clock-out': 'Dienst abgeschlossen' }
      const actionLabels = { 'clock-in': 'Arbeitsbeginn', 'break-start': 'Pause begonnen', 'break-end': 'Pause beendet', 'clock-out': 'Arbeitsende' }
      attendanceEvents.push({ id: `event-${attendanceEvents.length + 1}`, action: body.action, label: actionLabels[body.action] || body.action, clientOccurredAt: new Date().toISOString() })
      return json({ ok: true, state: labels[body.action] || 'idle', event: attendanceEvents.at(-1) })
    }
    if (path === '/api/attendance-time-edit') return json({ ok: true })
    if (path === '/api/work') return json({ ok: true })
    return json({ ok: true })
  })

  return { getAttendanceEvents: () => attendanceEvents, getCompany: () => company }
}

async function login(page, role = 'admin') {
  const user = users[role]
  await mockIdentity(page, user)
  await mockPortalApis(page, role)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()
}

async function navigate(page, label) {
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(page.locator('.sidebar')).toHaveClass(/open/)
  }
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}

async function expectNoHorizontalPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

test('public registration has no employee ID and remains usable on mobile', async ({ page }) => {
  await mockLoggedOutIdentity(page, { signupSucceeds: true })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Registrierung' }).click()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  await page.getByLabel('Vollständiger Name').fill('Test Mitarbeiter')
  await page.getByLabel('E-Mail-Adresse').fill('mitarbeiter@example.test')
  await page.getByLabel('Passwort').fill('SicheresPasswort123!')
  await page.getByLabel('Firma').fill('Habun Security')
  await page.getByLabel('Objekt / Einsatzort').fill('Objekt Nord')
  await page.getByRole('button', { name: 'Anfrage absenden' }).click()
  await expect(page.getByText(/Anfrage gesendet/i)).toBeVisible()
  await expectNoHorizontalPageOverflow(page)
})

test('admin uses one portal and settings remain open and save correctly', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await expect(page.getByRole('button', { name: 'Neue Zeiterfassung' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await navigate(page, 'Einstellungen')
  await expect(page.getByLabel('Firmenname')).toHaveValue('Habun Security')
  await page.getByLabel('Telefonnummer').fill('0511 999999')
  await page.getByLabel('E-Mail-Adresse').fill('buero@habun-security.de')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText(/Firmendaten wurden gespeichert/i)).toBeVisible()
  await page.waitForTimeout(400)
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible()
  await expect(page.getByText('buero@habun-security.de')).toBeVisible()
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/01-einstellungen-iphone.png', fullPage: true })
})

test('digital attendance supports work, pause, resume and work end', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await navigate(page, 'Zeiterfassung')
  await expect(page.locator('.digital-clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/02-zeiterfassung-iphone.png', fullPage: true })
  await page.getByRole('button', { name: /Arbeit beginnen/ }).click()
  await expect(page.getByText('Arbeitszeit läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause beginnen' }).click()
  await expect(page.getByText('Pause läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause beenden' }).click()
  await expect(page.getByText('Arbeitszeit läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Arbeit beenden' }).click()
  await expect(page.getByText('Dienst abgeschlossen', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Pause begonnen', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Pause beendet', { exact: true }).first()).toBeVisible()
})

test('mobile schedule opens a simple editor from a day card', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await navigate(page, 'Dienstplan')
  await expect(page.locator('.day-card')).toHaveCount(7)
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/03-dienstplan-iphone.png', fullPage: true })
  await page.getByLabel('Mitarbeiter').selectOption('employee-anna')
  await page.locator('.schedule-form select').nth(1).selectOption('site-nord')
  await page.getByLabel('Arbeitsbereich').fill('Zutrittskontrolle')
  await page.getByRole('button', { name: 'Als Entwurf speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toHaveCount(0)
  await expectNoHorizontalPageOverflow(page)
})

test('management downloads a valid schedule PDF', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Dienstplan')
  const downloadPromise = page.waitForEvent('download', { predicate: (download) => /Habun-Dienstplan.*\.pdf$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Dienstplan als PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  await expect(page.getByText(/Dienstplan wurde als PDF erstellt/i)).toBeVisible()
})

test('reports provide PDF preview, PDF download and Excel download', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await navigate(page, 'Berichte')
  await page.getByRole('button', { name: 'Stundenzettel Vorschau' }).click()
  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/04-berichte-iphone.png', fullPage: true })

  const pdfDownload = page.waitForEvent('download', { predicate: (download) => /\.pdf$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Stundenzettel PDF' }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/i)

  const excelDownload = page.waitForEvent('download', { predicate: (download) => /\.xlsx$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Stundenzettel Excel' }).click()
  expect((await excelDownload).suggestedFilename()).toMatch(/\.xlsx$/i)
})

test('employee sees only clock and own published schedule', async ({ page }, testInfo) => {
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
  await expect(page.locator('.digital-clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/05-mitarbeiter-stempeluhr-iphone.png', fullPage: true })
  if (testInfo.project.name === 'android-chromium') await page.screenshot({ path: 'artifacts/unified-preview/06-mitarbeiter-stempeluhr-android.png', fullPage: true })

  await page.getByRole('button', { name: 'Dienstplan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mein Dienstplan', exact: true })).toBeVisible()
  await expect(page.getByText('Objekt Nord', { exact: false })).toBeVisible()
  await expect(page.getByText('Zutrittskontrolle', { exact: false })).toBeVisible()
  await expect(page.getByText('Objekt Süd', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Bernd Muster', { exact: false })).toHaveCount(0)
  await expect(page.locator('.employee-shift-card')).toHaveCount(1)
  await expect(page.locator('.day-card')).toHaveCount(0)
  await expect(page.getByText('Kein Dienst', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/PDF|Excel/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Dienst am .* hinzufügen/ })).toHaveCount(0)
  await expect(page.getByText(/Vorwoche kopieren|Entwurf prüfen und freigeben|Dienst erstellen|Als Entwurf speichern/i)).toHaveCount(0)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/07-mitarbeiter-dienstplan-iphone.png', fullPage: true })
  if (testInfo.project.name === 'android-chromium') await page.screenshot({ path: 'artifacts/unified-preview/08-mitarbeiter-dienstplan-android.png', fullPage: true })
  await expectNoHorizontalPageOverflow(page)

  await page.getByRole('button', { name: 'Stempeluhr', exact: true }).click()
  await expect(page.locator('.digital-clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
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