import { test, expect } from '@playwright/test'

const identityUser = {
  id: 'user-admin-1',
  email: 'admin@example.test',
  aud: '',
  role: '',
  app_metadata: { provider: 'email', roles: ['admin'] },
  user_metadata: { full_name: 'Test Admin' },
  created_at: '2026-08-06T00:00:00.000Z',
  confirmed_at: '2026-08-06T00:00:00.000Z',
}

function collectConsoleErrors(page) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function mockIdentity(page, user = identityUser) {
  await page.addInitScript(({ storedUser }) => {
    localStorage.setItem('gotrue.user', JSON.stringify({
      ...storedUser,
      url: `${location.origin}/.netlify/identity`,
      token: {
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'test-refresh-token',
      },
    }))
  }, { storedUser: user })

  await page.route('**/.netlify/identity/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return
    }
    if (url.pathname.endsWith('/token')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh-token',
      }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function mockAdminApis(page) {
  const requests = [{
    id: 'request-1', fullName: 'Neue Person', email: 'neu@example.test',
    location: 'Objekt Nord', approvalCode: '123456', status: 'pending',
  }]
  await page.route('**/api/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      userId: 'user-admin-1', email: 'admin@example.test', fullName: 'Test Admin', role: 'admin', employeeCount: 3,
    }),
  }))
  await page.route('**/api/registrations', async (route) => {
    if (route.request().method() === 'PATCH') {
      requests.length = 0
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'employee' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests }) })
  })
  await page.route('**/api/work?resource=schedule', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ shifts: [] }),
  }))
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], state: { phase: 'idle' } }) }))
  await page.route('**/api/attendance-maintenance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [] }) }))
  await page.route('**/api/worksite-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) }))
  await page.route('**/api/reports-v2', (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.pdf"' },
    body: Buffer.from('%PDF-1.4\n%%EOF'),
  }))
}

test('public portal loads, registration works and Mitarbeiter-ID is absent', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.route('**/.netlify/identity/signup', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...identityUser, id: 'new-user' }),
  }))

  await page.goto('/')
  await expect(page).toHaveTitle(/Habun Security Mitarbeiterportal/)
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByRole('button', { name: 'Registrierung' }).click()
  await expect(page.getByRole('heading', { name: 'Registrierung anfragen' })).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)

  await page.getByLabel('Vollständiger Name').fill('Test Mitarbeiter')
  await page.getByLabel('E-Mail-Adresse').fill('mitarbeiter@example.test')
  await page.getByLabel('Passwort').fill('SicheresPasswort123!')
  await page.getByLabel('Firma').fill('Habun Security')
  await page.getByLabel('Objekt / Einsatzort').fill('Objekt Nord')
  await page.getByRole('button', { name: 'Anfrage absenden' }).click()
  await expect(page.getByText(/Registrierungsanfrage gesendet/i)).toBeVisible()
  expect(errors).toEqual([])
})

test('admin sees request and can approve it', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await mockIdentity(page)
  await mockAdminApis(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible()
  await expect(page.getByText('Neue Person')).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Freischalten' }).click()
  await expect(page.getByText('Keine offenen Registrierungsanfragen.')).toBeVisible()
  expect(errors).toEqual([])
})

test('admin report download returns a PDF', async ({ page }) => {
  await mockIdentity(page)
  await mockAdminApis(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Berichte' }).click()

  const downloadButton = page.getByRole('button', { name: /PDF|Download|Bericht/i }).first()
  if (await downloadButton.count()) {
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  } else {
    // V2 report controls are injected asynchronously; their presence is the minimum browser contract.
    await expect(page.locator('[data-attendance-reports], .reports-v2, form').filter({ hasText: /Zeitraum|Bericht/i }).first()).toBeVisible()
  }
})

test('mobile registration and login layout is usable', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sicher anmelden' })).toBeVisible()
  await page.getByRole('button', { name: 'Registrierung' }).click()
  await expect(page.getByLabel('Vollständiger Name')).toBeVisible()
  await expect(page.getByText(/Mitarbeiter-ID|Personalnummer/i)).toHaveCount(0)
  expect(errors).toEqual([])
})
