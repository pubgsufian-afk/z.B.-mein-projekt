import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function userFor(role) {
  return {
    id: `${role}-1`,
    email: `${role}@example.test`,
    aud: '',
    role: 'authenticated',
    app_metadata: { provider: 'email', roles: [role] },
    user_metadata: { full_name: role === 'admin' ? 'Test Admin' : role === 'manager' ? 'Test Einsatzleiter' : 'Test Hauptadmin' },
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

async function mockPortal(page, role, initialPauseAdjustment = null, mode = 'completed') {
  const user = userFor(role)
  const today = new Date().toISOString().slice(0, 10)
  let lastEditBody = null
  const entries = [
    {
      id: 'clock-in-1', userId: 'employee-anna', clientEventId: 'in-1', action: 'clock-in',
      clientOccurredAt: `${today}T07:00:00.000Z`, serverOccurredAt: `${today}T07:00:01.000Z`, eventDate: today,
      scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
    },
  ]
  if (mode === 'completed') {
    entries.push({
      id: 'clock-out-1', userId: 'employee-anna', clientEventId: 'out-1', action: 'clock-out',
      clientOccurredAt: `${today}T08:00:00.000Z`, serverOccurredAt: `${today}T08:00:01.000Z`, eventDate: today,
      scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
      ...(initialPauseAdjustment === null ? {} : { pauseMinutesAdjustment: initialPauseAdjustment }),
    })
  }

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
  await page.route('**/api/attendance-maintenance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [] }) }))
  await page.route('**/api/attendance-time-edit', async (route) => {
    const body = route.request().postDataJSON()
    lastEditBody = body
    const clockIn = entries.find((entry) => entry.id === body.clockInEventId)
    clockIn.clientOccurredAt = body.clockInAt
    clockIn.eventDate = body.clockInAt.slice(0, 10)

    let clockOut = body.clockOutEventId ? entries.find((entry) => entry.id === body.clockOutEventId) : null
    if (body.clockOutAt) {
      if (!clockOut) {
        clockOut = {
          id: 'managed-clock-out-1', userId: 'employee-anna', clientEventId: 'managed-out-1', action: 'clock-out',
          clientOccurredAt: body.clockOutAt, serverOccurredAt: body.clockOutAt, eventDate: body.clockOutAt.slice(0, 10),
          scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'unavailable', offlineCaptured: false,
        }
        entries.push(clockOut)
      } else {
        clockOut.clientOccurredAt = body.clockOutAt
        clockOut.eventDate = body.clockOutAt.slice(0, 10)
      }
      clockOut.pauseMinutesAdjustment = body.pauseMinutes
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ saved: true, clockInEventId: clockIn.id, clockOutEventId: clockOut?.id || null, open: !clockOut }),
    })
  })
  await page.route('**/api/attendance**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/attendance') return route.fallback()
    const resource = url.searchParams.get('resource')
    if (resource === 'history') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) })
    if (resource === 'live') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [] }) })
  })

  return { user, today, getLastEditBody: () => lastEditBody }
}

async function loginAndOpenTimes(page, role, initialPauseAdjustment = null, mode = 'completed') {
  const portal = await mockPortal(page, role, initialPauseAdjustment, mode)
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) await menu.click()
  await page.getByRole('button', { name: 'Stundenzettel', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Stundenzettel')
  return portal
}

function firstActualCard(page) {
  return page.locator('.actual-timesheet-list > article.timesheet-card').first()
}

test('admin edits a completed session and corrected totals are shown', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'admin')
  const card = firstActualCard(page)
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Arbeitszeit bearbeiten', exact: true })).toBeVisible()
  await page.getByLabel('Pause in Minuten').fill('15')
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('15 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:45 Std.', { exact: true })).toBeVisible()
  await expect(page.locator('.timesheet-grand-total').getByText('0:45 Std.', { exact: true })).toBeVisible()

  expect(portal.getLastEditBody()).toMatchObject({
    clockInEventId: 'clock-in-1',
    clockOutEventId: 'clock-out-1',
    pauseMinutes: 15,
    reason: 'Bearbeitung im Stundenzettel',
  })
})

test('manager can directly edit a completed employee session', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', 20)
  const card = firstActualCard(page)
  await expect(card.getByText('20 Min.', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await page.getByLabel('Pause in Minuten').fill('10')
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:50 Std.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({ pauseMinutes: 10, reason: 'Bearbeitung im Stundenzettel' })
})

test('manager can edit an already checked-in running session and close it with pause', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', null, 'open')
  const card = firstActualCard(page)
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  const end = page.getByLabel('Ende')
  const pause = page.getByLabel('Pause in Minuten')
  await expect(end).toHaveValue('')

  await end.fill('10:00')
  await pause.fill('10')
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:50 Std.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({
    clockInEventId: 'clock-in-1',
    clockOutEventId: null,
    pauseMinutes: 10,
    reason: 'Bearbeitung im Stundenzettel',
  })
  expect(portal.getLastEditBody().clockOutAt).toBeTruthy()
})