import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function userFor(role) {
  return {
    id: `${role}-role-test`,
    email: `${role}.roles@example.test`,
    aud: '',
    role: 'authenticated',
    app_metadata: { provider: 'email', roles: [role] },
    user_metadata: { full_name: role === 'owner' ? 'Hauptadmin Test' : 'Admin Test' },
    created_at: '2026-08-07T00:00:00.000Z',
    confirmed_at: '2026-08-07T00:00:00.000Z',
    updated_at: '2026-08-07T00:00:00.000Z',
  }
}

function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  })}.test-signature`
  return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user }
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
  const user = userFor(role)
  let employeeRole = 'employee'
  let lastPatch = null

  await page.route('**/api/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role }),
  }))
  await page.route('**/api/registrations', async (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      lastPatch = request.postDataJSON()
      employeeRole = lastPatch.role
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, employee: { userId: 'employee-adel', fullName: 'Adel Abdal', location: 'Abbott', role: employeeRole, status: 'active' }, role: employeeRole }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requests: [],
        employees: [{ userId: 'employee-adel', fullName: 'Adel Abdal', location: 'Abbott', role: employeeRole, status: 'active' }],
        archived: [],
      }),
    })
  })
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [], entries: [] }) }))

  return { user, getLastPatch: () => lastPatch }
}

async function loginAndOpenEmployees(page, role) {
  const portal = await mockPortal(page, role)
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) await menu.click()
  await page.getByRole('button', { name: 'Mitarbeiter', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Mitarbeiter')
  await expect(page.getByText('Adel Abdal', { exact: true })).toBeVisible()
  return portal
}

test('Hauptadmin can assign Einsatzleiter role to an active employee', async ({ page }) => {
  const portal = await loginAndOpenEmployees(page, 'owner')
  const select = page.getByLabel('Rolle für Adel Abdal')
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="admin"]')).toHaveCount(1)
  await select.selectOption('manager')
  await page.getByRole('button', { name: 'Rolle ändern', exact: true }).click()
  await expect(page.getByText('Adel Abdal ist jetzt Einsatzleiter.')).toBeVisible()
  await expect(page.getByText('Einsatzleiter', { exact: true })).toBeVisible()
  expect(portal.getLastPatch()).toMatchObject({ id: 'employee-adel', action: 'update-role', role: 'manager' })
})

test('normal Admin may assign Einsatzleiter but cannot assign Admin', async ({ page }) => {
  await loginAndOpenEmployees(page, 'admin')
  const select = page.getByLabel('Rolle für Adel Abdal')
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="manager"]')).toHaveCount(1)
  await expect(select.locator('option[value="admin"]')).toHaveCount(0)
})
