import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function ownerUser() {
  return {
    id: 'owner-refresh-test', email: 'owner.refresh@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['owner'] },
    user_metadata: { full_name: 'Refresh Test' },
    created_at: '2026-08-17T00:00:00.000Z', confirmed_at: '2026-08-17T00:00:00.000Z', updated_at: '2026-08-17T00:00:00.000Z',
  }
}

function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now, app_metadata: user.app_metadata, user_metadata: user.user_metadata })}.test-signature`,
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user,
  }
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

async function loginOwner(page, scheduleResponder) {
  const user = ownerUser()
  await mockIdentity(page, user)
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role: 'owner' }) }))
  await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [], archived: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
  await page.route('**/api/schedule-v2**', scheduleResponder)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Übersicht')
}

async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  const target = sidebar.getByRole('button', { name: label, exact: true })
  await target.evaluate((button) => button.click())
  await expect(page.locator('.topbar h1')).toHaveText(label)
}

test('visible Dienstplan refreshes after app resume without reopening', async ({ page }) => {
  let version = 1
  await loginOwner(page, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('resource') === 'entries') {
      const from = url.searchParams.get('from')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [{ id: 'resume-shift', employeeUserId: 'employee-1', employeeName: `Version ${version}`, date: from, start: '07:00', end: '17:00', pauseMinutes: 0, location: 'Objekt', workArea: 'Dienst', status: 'published' }] }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) })
  })

  await navigate(page, 'Dienstplan')
  await expect(page.getByText('Version 1').first()).toBeVisible()
  version = 2
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByText('Version 2').first()).toBeVisible()
  await expect(page.getByLabel('E-Mail-Adresse')).toHaveCount(0)
})

test('failed background refresh keeps the previous Dienstplan visible', async ({ page }) => {
  let failRefresh = false
  await loginOwner(page, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('resource') === 'entries') {
      if (failRefresh) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Test refresh failed' }) })
      const from = url.searchParams.get('from')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [{ id: 'stable-shift', employeeUserId: 'employee-1', employeeName: 'Bleibt sichtbar', date: from, start: '07:00', end: '17:00', pauseMinutes: 0, location: 'Objekt', workArea: 'Dienst', status: 'published' }] }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) })
  })

  await navigate(page, 'Dienstplan')
  await expect(page.getByText('Bleibt sichtbar').first()).toBeVisible()
  failRefresh = true
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByText('Bleibt sichtbar').first()).toBeVisible()
})
