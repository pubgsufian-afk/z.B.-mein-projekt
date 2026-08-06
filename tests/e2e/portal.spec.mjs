import { test, expect } from '@playwright/test'

const identityUser = {
  id: 'user-admin-1', email: 'admin@example.test', aud: '', role: 'authenticated',
  app_metadata: { provider: 'email', roles: ['admin'] },
  user_metadata: { full_name: 'Test Admin' },
  created_at: '2026-08-06T00:00:00.000Z', confirmed_at: '2026-08-06T00:00:00.000Z',
  updated_at: '2026-08-06T00:00:00.000Z',
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function jwtFor(user) {
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated',
    exp: now + 3600, iat: now, app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  })}.test-signature`
}
function tokenResponse(user) {
  return {
    access_token: jwtFor(user), token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'test-refresh-token', user,
  }
}

function collectConsoleErrors(page) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function mockLoggedOutIdentity(page, { signupSucceeds = false } = {}) {
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: false, external: {} }) })
    if (url.pathname.endsWith('/signup') && request.method() === 'POST' && signupSucceeds) {
      const user = {
        id: 'new-user', aud: '', role: '', email: 'mitarbeiter@example.test',
        app_metadata: { provider: 'email', roles: [] },
        user_metadata: { full_name: 'Test Mitarbeiter' },
        created_at: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-06T00:00:00.000Z',
        confirmation_sent_at: '2026-08-06T00:00:00.000Z', confirmed_at: null,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_token', error_description: 'Not logged in' }) })
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_request' }) })
  })
}

async function mockIdentity(page, user = identityUser) {
  let authenticated = false
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    if (url.pathname.endsWith('/token') && request.method() === 'POST') {
      authenticated = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(user)) })
    }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? user : { error: 'invalid_token' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function loginAsAdmin(page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByLabel('E-Mail-Adresse').fill('admin@example.test')
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible()
}

async function mockAdminApis(page) {
  const requests = [{ id: 'request-1', fullName: 'Neue Person', email: 'neu@example.test', location: 'Objekt Nord', approvalCode: '123456', status: 'pending' }]
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'user-admin-1', email: 'admin@example.test', fullName: 'Test Admin', role: 'admin', employeeCount: 3 }) }))
  await page.route('**/api/registrations', async (route) => {
    if (route.request().method() === 'PATCH') { requests.length = 0; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'employee' }) }) }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests }) })
  })
  await page.route('**/api/work?resource=schedule', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shifts: [] }) }))
  await page.route('**/api/work?resource=timesheets**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }))
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], state: { phase: 'idle' } }) }))
  await page.route('**/api/attendance-maintenance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [] }) }))
  await page.route('**/api/worksite-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) }))
  await page.route('**/api/reports-v2', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.pdf"' }, body: Buffer.from('%PDF-1.4\n%%EOF') }))
}

async function openReports(page) {
  const menu = page.locator('.hamburger-button')
  if (await menu.isVisible().catch(() => false)) await menu.click()
  const reports = page.getByRole('button', { name: 'Berichte', exact: true })
  await reports.evaluate((element) => element.click())
  await expect(page.getByRole('heading', { name: 'Berichte', exact: true })).toBeVisible()
}

test('public portal loads, registration works and Mitarbeiter-ID is absent', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockLoggedOutIdentity(page, { signupSucceeds: true })
  await page.route('**/api/registrations', (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Registrierungsanfrage gesendet.', requestId: 'request-new' }),
  }))
  await page.goto('/')
  await expect(page).toHaveTitle(/Habun Security Mitarbeiterportal/)
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByRole('tab', { name: 'Registrierung' }).click()
  await expect(page.getByRole('heading', { name: 'Registrierung anfragen' })).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  await page.getByLabel('Vollständiger Name').fill('Test Mitarbeiter')
  await page.getByLabel('E-Mail-Adresse').fill('mitarbeiter@example.test')
  await page.getByLabel('Passwort').fill('SicheresPasswort123!')
  await page.getByLabel('Firma').fill('Habun Security')
  await page.getByLabel('Objekt / Einsatzort').fill('Objekt Nord')
  await page.getByRole('button', { name: 'Anfrage absenden' }).click()
  await expect(page.locator('.notice')).toContainText(/Anfrage gesendet/i)
  expect(errors).toEqual([])
})

test('admin sees request and can approve it', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockIdentity(page); await mockAdminApis(page); await loginAsAdmin(page)
  await expect(page.getByText('Neue Person')).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Freischalten' }).click()
  await expect(page.getByText('Keine offenen Registrierungsanfragen.')).toBeVisible()
  expect(errors).toEqual([])
})

test('admin report area is available and PDF endpoint downloads', async ({ page }) => {
  await mockIdentity(page); await mockAdminApis(page); await loginAsAdmin(page); await openReports(page)
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/reports-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportType: 'combined', from: '2026-08-01', to: '2026-08-31', userIds: [] }) })
    return { ok: response.ok, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), size: (await response.blob()).size }
  })
  expect(result.ok).toBeTruthy(); expect(result.type).toContain('application/pdf'); expect(result.disposition).toMatch(/\.pdf/i); expect(result.size).toBeGreaterThan(0)
})

test('mobile registration and login layout is usable', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockLoggedOutIdentity(page); await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sicher anmelden' })).toBeVisible()
  await page.getByRole('tab', { name: 'Registrierung' }).click()
  await expect(page.getByLabel('Vollständiger Name')).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  expect(errors).toEqual([])
})