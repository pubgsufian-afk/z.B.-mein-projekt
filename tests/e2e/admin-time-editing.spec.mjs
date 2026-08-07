import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function userFor(role) {
  return {
    id: `${role}-1`,
    email: `${role}@example.test`,
    aud: '',
    role: 'authenticated',
    app_metadata: { provider: 'email', roles: [role] },
    user_metadata: { full_name: role === 'admin' ? 'Test Admin' : 'Test Einsatzleiter' },
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

async function mockPortal(page, role, initialPauseAdjustment = null) {
  const user = userFor(role)
  const today = new Date().toISOString().slice(0, 10)
  let lastEditBody = null
  const entries = [
    {
      id: 'clock-in-1', userId: 'employee-anna', clientEventId: 'in-1', action: 'clock-in',
      clientOccurredAt: `${today}T07:00:00.000Z`, serverOccurredAt: `${today}T07:00:01.000Z`, eventDate: today,
      scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
    },
    {
      id: 'clock-out-1', userId: 'employee-anna', clientEventId: 'out-1', action: 'clock-out',
      clientOccurredAt: `${today}T08:00:00.000Z`, serverOccurredAt: `${today}T08:00:01.000Z`, eventDate: today,
      scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
      ...(initialPauseAdjustment === null ? {} : { pauseMinutesAdjustment: initialPauseAdjustment }),
    },
  ]

  await page.route('**/api/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role }),
  }))
  await page.route('**/api/registrations', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], employees: [{ userId: 'employee-anna', fullName: 'Anna Beispiel', location: 'Objekt Nord' }], archived: [] }),
  }))
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance-maintenance**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      if (body.action === 'admin-time-edit') {
        lastEditBody = body
        const clockIn = entries.find((entry) => entry.id === body.clockInEventId)
        const clockOut = entries.find((entry) => entry.id === body.clockOutEventId)
        clockIn.clientOccurredAt = body.clockInAt
        clockIn.eventDate = body.clockInAt.slice(0, 10)
        clockOut.clientOccurredAt = body.clockOutAt
        clockOut.eventDate = body.clockOutAt.slice(0, 10)
        clockOut.pauseMinutesAdjustment = body.pauseMinutes
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: true, clockInEventId: clockIn.id, clockOutEventId: clockOut.id }) })
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [] }) })
  })
  await page.route('**/api/attendance**', async (route) => {
    const url = new URL(route.request().url())
    const resource = url.searchParams.get('resource')
    if (resource === 'history') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) })
    if (resource === 'live') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [] }) })
  })

  return { user, getLastEditBody: () => lastEditBody }
}

async function loginAndOpenTimes(page, role, initialPauseAdjustment = null) {
  const portal = await mockPortal(page, role, initialPauseAdjustment)
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) await menu.click()
  await page.getByRole('button', { name: 'Zeiten', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Zeiten')
  return portal
}

test('admin edits a completed session and corrected totals are shown', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'admin')
  const card = page.locator('.times-list > article').first()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Arbeitszeit bearbeiten', exact: true })).toBeVisible()
  await page.getByLabel('Pause in Minuten').fill('15')
  await page.getByLabel('Begründung').fill('Korrektur durch Admin')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('15 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:45 Std.', { exact: true })).toBeVisible()
  await expect(page.locator('.metric-strip.compact-metrics').getByText('0:15 Std.', { exact: true })).toBeVisible()
  await expect(page.locator('.metric-strip.compact-metrics').getByText('0:45 Std.', { exact: true })).toBeVisible()

  expect(portal.getLastEditBody()).toMatchObject({
    action: 'admin-time-edit',
    clockInEventId: 'clock-in-1',
    clockOutEventId: 'clock-out-1',
    pauseMinutes: 15,
    reason: 'Korrektur durch Admin',
  })
})

test('manager sees corrected time but has no direct edit button', async ({ page }) => {
  await loginAndOpenTimes(page, 'manager', 20)
  const card = page.locator('.times-list > article').first()
  await expect(card.getByText('20 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:40 Std.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0)
})
