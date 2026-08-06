import { test, expect } from '@playwright/test'

const users = {
  admin: {
    id: 'admin-1', email: 'admin@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['admin'] },
    user_metadata: { full_name: 'Test Admin' },
    created_at: '2026-08-06T00:00:00.000Z', confirmed_at: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-06T00:00:00.000Z',
  },
  employee: {
    id: 'employee-anna', email: 'anna@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['employee'] },
    user_metadata: { full_name: 'Anna Beispiel' },
    created_at: '2026-08-06T00:00:00.000Z', confirmed_at: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-06T00:00:00.000Z',
  },
}

const employees = [
  { userId: 'employee-anna', fullName: 'Anna Beispiel', location: 'Objekt Nord' },
  { userId: 'employee-bernd', fullName: 'Bernd Muster', location: 'Objekt Süd' },
]

const objects = [
  { id: 'site-nord', name: 'Objekt Nord', address: 'Musterstraße 1, Hannover', latitude: 52.375, longitude: 9.732, radiusMeters: 500 },
]

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  })}.test-signature`
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user }
}

async function mockLoggedOutIdentity(page, { signupSucceeds = false } = {}) {
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: false, external: {} }) })
    if (url.pathname.endsWith('/signup') && request.method() === 'POST' && signupSucceeds) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'new-user', aud: '', role: '', email: 'mitarbeiter@example.test',
        app_metadata: { provider: 'email', roles: [] }, user_metadata: { full_name: 'Test Mitarbeiter' },
        created_at: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-06T00:00:00.000Z', confirmation_sent_at: '2026-08-06T00:00:00.000Z', confirmed_at: null,
      }) })
    }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_token' }) })
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_request' }) })
  })
}

async function mockIdentity(page, user) {
  let authenticated = false
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    if (url.pathname.endsWith('/token') && request.method() === 'POST') {
      authenticated = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(user)) })
    }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? user : { error: 'invalid_token' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

function attendanceState(events, schedule) {
  let phase = 'idle'
  let clockInAt = null
  let clockOutAt = null
  for (const event of events) {
    if (event.action === 'clock-in') { phase = 'working'; clockInAt = event.clientOccurredAt; clockOutAt = null }
    if (event.action === 'break-start') phase = 'paused'
    if (event.action === 'break-end') phase = 'working'
    if (event.action === 'clock-out') { phase = 'completed'; clockOutAt = event.clientOccurredAt }
  }
  return { phase, clockInAt, clockOutAt, events, schedule, schedules: schedule ? [schedule] : [] }
}

async function mockPortalApis(page, role = 'admin') {
  let company = { companyName: 'Habun Security', phone: '0511 123456', email: 'info@habun-security.de', logoUrl: '/habun-logo.png' }
  let attendanceEvents = []
  const schedule = {
    id: 'shift-1', employeeUserId: 'employee-anna', employeeName: 'Anna Beispiel', date: new Date().toISOString().slice(0, 10),
    start: '07:00', end: '17:00', pauseMinutes: 30, objectId: 'site-nord', location: 'Objekt Nord', workArea: 'Zutrittskontrolle', status: 'published', version: 1,
  }
  const requests = [{ id: 'request-1', fullName: 'Neue Person', email: 'neu@example.test', location: 'Objekt Nord', status: 'pending' }]

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition(success) { success({ coords: { latitude: 52.375, longitude: 9.732, accuracy: 8 } }) } },
    })
  })

  await page.route('**/api/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ userId: role === 'employee' ? 'employee-anna' : 'admin-1', email: role === 'employee' ? 'anna@example.test' : 'admin@example.test', fullName: role === 'employee' ? 'Anna Beispiel' : 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),
  }))

  await page.route('**/api/registrations', async (route) => {
    if (route.request().method() === 'PATCH') {
      requests.length = 0
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests, employees, archived: [] }) })
  })

  await page.route('**/api/schedule-v2**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      const resource = url.searchParams.get('resource')
      if (resource === 'objects') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects }) })
      const visible = role === 'employee' ? [schedule] : [schedule]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: visible }) })
    }
    const body = request.postDataJSON()
    if (body.action === 'save') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ shift: { ...body, id: body.id || 'shift-new' }, warnings: [] }) })
    if (body.action === 'repeat') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ created: [] }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 2 }) })
  })

  await page.route('**/api/attendance**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      if (url.searchParams.get('resource') === 'live') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: attendanceEvents.map((event) => ({ ...event, employeeName: 'Anna Beispiel', workSiteName: 'Objekt Nord' })) }) })
      if (url.searchParams.get('resource') === 'history') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: attendanceEvents }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(attendanceState(attendanceEvents, schedule)) })
    }
    const body = request.postDataJSON()
    attendanceEvents.push({
      id: `event-${attendanceEvents.length + 1}`, userId: 'employee-anna', clientEventId: body.clientEventId, action: body.action,
      clientOccurredAt: body.clientOccurredAt, eventDate: body.clientOccurredAt.slice(0, 10), scheduleId: schedule.id, objectId: schedule.objectId,
      locationStatus: body.action === 'clock-in' || body.action === 'clock-out' ? 'inside' : 'unavailable', offlineCaptured: false,
    })
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ event: attendanceEvents.at(-1), replayed: false }) })
  })

  await page.route('**/api/attendance-maintenance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [] }) }))

  await page.route('**/api/company-settings', async (route) => {
    if (route.request().method() === 'PUT') company = route.request().postDataJSON()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: company }) })
  })

  await page.route('**/api/unified-reports', async (route) => {
    const format = route.request().postDataJSON().format
    if (format === 'xlsx') {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'Content-Disposition': 'attachment; filename="Habun-Stundenbericht.xlsx"' },
        body: Buffer.from('PK\u0003\u0004test-xlsx'),
      })
    }
    return route.fulfill({
      status: 200, contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="Habun-Stundenbericht.pdf"' },
      body: Buffer.from('%PDF-1.4\n%%EOF'),
    })
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
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
}

async function navigate(page, label) {
  const button = page.getByRole('button', { name: label, exact: true })
  if (!(await button.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Menü öffnen' }).click()
  }
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
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

test('admin uses one portal and settings remain open and save correctly', async ({ page }) => {
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
})

test('digital attendance supports work, pause, resume and work end', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Zeiterfassung')
  await expect(page.locator('.digital-clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
  await page.getByRole('button', { name: /Arbeit beginnen/ }).click()
  await expect(page.getByText('Arbeitszeit läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause beginnen' }).click()
  await expect(page.getByText('Pause läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause beenden' }).click()
  await expect(page.getByText('Arbeitszeit läuft', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Arbeit beenden' }).click()
  await expect(page.getByText('Dienst abgeschlossen', { exact: true })).toBeVisible()
  await expect(page.getByText('Pause begonnen', { exact: true })).toBeVisible()
  await expect(page.getByText('Pause beendet', { exact: true })).toBeVisible()
})

test('mobile schedule opens a simple editor from a day card', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Dienstplan')
  await expect(page.locator('.day-card')).toHaveCount(7)
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()
  await page.getByLabel('Mitarbeiter').selectOption('employee-anna')
  await page.getByLabel('Einsatzort').selectOption('site-nord')
  await page.getByLabel('Arbeitsbereich').fill('Zutrittskontrolle')
  await page.getByRole('button', { name: 'Als Entwurf speichern' }).click()
  await expect(page.getByText(/Dienst als Entwurf gespeichert/i)).toBeVisible()
  await expectNoHorizontalPageOverflow(page)
})

test('reports provide PDF preview, PDF download and Excel download', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Berichte')
  await page.getByRole('button', { name: 'PDF-Vorschau' }).click()
  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()

  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF herunterladen' }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/i)

  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel herunterladen' }).click()
  expect((await excelDownload).suggestedFilename()).toMatch(/\.xlsx$/i)
})

test('employee sees only personal operational pages and no administration', async ({ page }) => {
  await login(page, 'employee')
  await expect(page.getByRole('button', { name: 'Mitarbeiter', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Einsatzorte', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Berichte', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toHaveCount(0)
  await navigate(page, 'Meine Zeiten')
  await expect(page.getByRole('button', { name: /PDF|Excel/ })).toHaveCount(0)
  await expectNoHorizontalPageOverflow(page)
})
