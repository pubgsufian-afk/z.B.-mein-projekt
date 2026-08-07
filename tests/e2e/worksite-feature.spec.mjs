import { test, expect } from '@playwright/test'

const admin = {
  id: 'admin-1', email: 'admin@example.test', aud: '', role: 'authenticated',
  app_metadata: { provider: 'email', roles: ['admin'] },
  user_metadata: { full_name: 'Test Admin' },
  created_at: '2026-08-07T00:00:00.000Z', confirmed_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
}

const employees = [
  { userId: 'employee-anna', fullName: 'Anna Beispiel', location: 'Zentrale' },
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

async function mockIdentity(page) {
  let authenticated = false
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    }
    if (url.pathname.endsWith('/token') && request.method() === 'POST') {
      authenticated = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(admin)) })
    }
    if (url.pathname.endsWith('/user')) {
      return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? admin : { error: 'invalid_token' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function mockPortal(page) {
  let worksiteObjects = [
    { id: 'site-nord', name: 'Zentrale', address: 'Musterstraße 1, Hannover', latitude: 52.375, longitude: 9.732, radiusMeters: 500 },
  ]

  await page.route('**/api/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ userId: admin.id, email: admin.email, fullName: 'Test Admin', role: 'admin', employeeCount: employees.length, location: 'Zentrale' }),
  }))

  await page.route('**/api/registrations', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], employees, archived: [] }),
  }))

  await page.route('**/api/schedule-v2**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      if (url.searchParams.get('resource') === 'objects') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: worksiteObjects }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    }

    const body = request.postDataJSON()
    if (body.action === 'object-delete') {
      worksiteObjects = worksiteObjects.filter((object) => object.id !== body.id)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true, id: body.id }) })
    }
    if (body.action === 'save') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ shift: { ...body, id: 'shift-new' }, warnings: [] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.route('**/api/attendance**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ phase: 'idle', events: [], schedules: [], schedule: null, entries: [] }),
  }))

  return { getWorksites: () => worksiteObjects }
}

async function login(page) {
  await mockIdentity(page)
  const state = await mockPortal(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByLabel('E-Mail-Adresse').fill(admin.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  return state
}

async function navigate(page, label) {
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(page.locator('.sidebar')).toHaveClass(/open/)
  }
  await page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}

async function expectNoHorizontalPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

test('saved worksite autofills schedule location and can be deleted safely', async ({ page }) => {
  const state = await login(page)

  await navigate(page, 'Dienstplan')
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Dienst erstellen', exact: true })).toBeVisible()
  await page.locator('.schedule-form select').nth(1).selectOption('site-nord')
  await expect(page.getByLabel('Bezeichnung des Einsatzortes')).toHaveValue('Zentrale')
  await expectNoHorizontalPageOverflow(page)

  await navigate(page, 'Einsatzorte')
  await expect(page.getByText('Zentrale', { exact: true })).toBeVisible()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Alte Dienstpläne bleiben unverändert')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Einsatzort löschen' }).click()

  await expect(page.getByText('Einsatzort wurde gelöscht. Alte Dienstpläne bleiben unverändert.')).toBeVisible()
  await expect(page.getByText('Zentrale', { exact: true })).toHaveCount(0)
  expect(state.getWorksites()).toHaveLength(0)
  await expectNoHorizontalPageOverflow(page)
})
