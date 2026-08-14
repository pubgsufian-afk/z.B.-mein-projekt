import { test, expect } from '@playwright/test'

const users = {
  admin: {
    id: 'admin-daily', email: 'daily-admin@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['admin'] },
    user_metadata: { full_name: 'Daily Admin' },
    created_at: '2026-08-14T00:00:00.000Z', confirmed_at: '2026-08-14T00:00:00.000Z', updated_at: '2026-08-14T00:00:00.000Z',
  },
  employee: {
    id: 'employee-daily', email: 'daily-employee@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['employee'] },
    user_metadata: { full_name: 'Daily Employee' },
    created_at: '2026-08-14T00:00:00.000Z', confirmed_at: '2026-08-14T00:00:00.000Z', updated_at: '2026-08-14T00:00:00.000Z',
  },
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  })}.test-signature`
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user }
}

function berlinToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const pick = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
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

async function mockPortal(page, role) {
  const today = berlinToday()
  let reports = [{
    id: 'report-1',
    text: 'Erster Testbericht',
    authorId: 'admin-daily',
    authorName: 'Daily Admin',
    createdAt: `${today}T08:15:00.000Z`,
  }]
  const pdfRequests = []
  let deleteCalls = 0

  await page.route('**/api/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      userId: role === 'admin' ? 'admin-daily' : 'employee-daily',
      email: role === 'admin' ? users.admin.email : users.employee.email,
      fullName: role === 'admin' ? 'Daily Admin' : 'Daily Employee',
      role,
      employeeCount: 1,
    }),
  }))
  await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [], archived: [] }) }))
  await page.route('**/api/settings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: {} }) }))
  await page.route('**/api/company-settings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: { companyName: 'Habun Security' } }) }))
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance**', (route) => {
    const url = new URL(route.request().url())
    const body = url.searchParams.get('resource') === 'live'
      ? { entries: [] }
      : { phase: 'idle', events: [], entries: [], schedules: [] }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  await page.route('**/api/daily-reports**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.pathname === '/api/daily-reports-pdf') {
      pdfRequests.push({ id: url.searchParams.get('id'), date: url.searchParams.get('date') })
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="Tagesbericht-Test.pdf"' },
        body: Buffer.from('%PDF-1.7\n%%EOF'),
      })
    }

    if (role !== 'admin') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Keine Berechtigung.' }) })

    if (request.method() === 'GET') {
      const date = url.searchParams.get('date')
      const visible = date === today ? reports : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reports: visible }) })
    }

    if (request.method() === 'PATCH') {
      const id = url.searchParams.get('id')
      const body = request.postDataJSON()
      reports = reports.map((report) => report.id === id ? {
        ...report,
        text: body.text,
        updatedAt: `${today}T12:45:00.000Z`,
        updatedById: 'admin-daily',
        updatedByName: 'Daily Admin',
      } : report)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ report: reports.find((report) => report.id === id) }) })
    }

    if (request.method() === 'DELETE') {
      deleteCalls += 1
      const id = url.searchParams.get('id')
      reports = reports.filter((report) => report.id !== id)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true, id }) })
    }

    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  return {
    today,
    pdfRequests,
    getDeleteCalls: () => deleteCalls,
  }
}

async function login(page, role = 'admin') {
  const user = users[role]
  await mockIdentity(page, user)
  const portal = await mockPortal(page, role)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.locator('.topbar h1')).toHaveText(role === 'admin' ? 'Übersicht' : 'Stempeluhr')
  return portal
}

test('admin edits, downloads and permanently deletes daily reports with confirmation', async ({ page }) => {
  const portal = await login(page, 'admin')

  await page.getByRole('button', { name: 'Berichte öffnen' }).click()
  await expect(page.getByLabel('Datum')).toHaveValue(portal.today)
  await expect(page.getByText('Erster Testbericht')).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten' }).first().click()
  await expect(page.getByRole('heading', { name: 'Bericht bearbeiten' })).toBeVisible()
  await page.getByLabel('Bericht').fill('Bearbeiteter Testbericht')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Bearbeiteter Testbericht')).toBeVisible()
  await expect(page.getByText(/Zuletzt bearbeitet am/)).toBeVisible()

  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  await expect.poll(() => portal.pdfRequests.some((request) => request.id === 'report-1')).toBeTruthy()

  await page.getByRole('button', { name: 'Tages-PDF herunterladen' }).click()
  await expect.poll(() => portal.pdfRequests.some((request) => request.date === portal.today)).toBeTruthy()

  await page.getByRole('button', { name: 'Löschen', exact: true }).click()
  await expect(page.getByText('Bericht wirklich endgültig löschen?')).toBeVisible()
  expect(portal.getDeleteCalls()).toBe(0)

  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.getByText('Bericht wirklich endgültig löschen?')).toHaveCount(0)
  await expect(page.getByText('Bearbeiteter Testbericht')).toBeVisible()
  expect(portal.getDeleteCalls()).toBe(0)

  await page.getByRole('button', { name: 'Löschen', exact: true }).click()
  await page.getByRole('button', { name: 'Endgültig löschen' }).click()
  await expect.poll(() => portal.getDeleteCalls()).toBe(1)
  await expect(page.getByText('Bearbeiteter Testbericht')).toHaveCount(0)
  await expect(page.getByText('Für dieses Datum sind keine Tagesberichte gespeichert.')).toBeVisible()
})

test('normal employee never sees daily report management', async ({ page }) => {
  await login(page, 'employee')
  await expect(page.getByText('Tagesbericht', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Berichte öffnen' })).toHaveCount(0)
})
