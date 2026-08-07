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
  const clockIn = {
    id: 'clock-in-1', userId: 'employee-anna', clientEventId: 'in-1', action: 'clock-in',
    clientOccurredAt: `${today}T07:00:00.000Z`, serverOccurredAt: `${today}T07:00:01.000Z`, eventDate: today,
    scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
    ...(mode === 'open' && initialPauseAdjustment !== null ? { pauseMinutesAdjustment: initialPauseAdjustment } : {}),
  }
  const entries = [clockIn]
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
  await page.route('**/api/attendance-time-edit-v2', async (route) => {
    const body = route.request().postDataJSON()
    lastEditBody = body
    const selectedClockIn = entries.find((entry) => entry.id === body.clockInEventId)
    selectedClockIn.clientOccurredAt = body.clockInAt
    selectedClockIn.eventDate = body.clockInAt.slice(0, 10)

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
    } else {
      selectedClockIn.pauseMinutesAdjustment = body.pauseMinutes
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ saved: true, clockInEventId: selectedClockIn.id, clockOutEventId: clockOut?.id || null, open: !clockOut }),
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
  await page.getByRole('button', { name: 'Zeiten', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Zeiten')
  return portal
}

test('admin edits a completed session without entering a reason', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'admin')
  const card = page.locator('.times-list > article').first()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Arbeitszeit bearbeiten', exact: true })).toBeVisible()
  await expect(page.getByLabel('Begründung')).toHaveCount(0)
  await page.getByLabel('Pause in Minuten').fill('15')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('15 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:45 Std.', { exact: true })).toBeVisible()
  await expect(page.locator('.metric-strip.compact-metrics').getByText('0:15 Std.', { exact: true })).toBeVisible()
  await expect(page.locator('.metric-strip.compact-metrics').getByText('0:45 Std.', { exact: true })).toBeVisible()

  expect(portal.getLastEditBody()).toMatchObject({
    clockInEventId: 'clock-in-1',
    clockOutEventId: 'clock-out-1',
    pauseMinutes: 15,
  })
  expect(portal.getLastEditBody()).not.toHaveProperty('reason')
})

test('manager can directly edit a completed employee session without a reason field', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', 20)
  const card = page.locator('.times-list > article').first()
  await expect(card.getByText('20 Min.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await expect(page.getByLabel('Begründung')).toHaveCount(0)
  await page.getByLabel('Pause in Minuten').fill('10')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({ pauseMinutes: 10 })
  expect(portal.getLastEditBody()).not.toHaveProperty('reason')
})

test('manager can edit pause on a running session without ending the shift', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', null, 'open')
  const card = page.locator('.times-list > article').first()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  const end = page.locator('[data-admin-time-end]')
  const pause = page.getByLabel('Pause in Minuten')
  await expect(end).toHaveValue('')
  await expect(pause).toHaveJSProperty('readOnly', false)
  await expect(page.getByLabel('Begründung')).toHaveCount(0)

  await pause.fill('10')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({
    clockInEventId: 'clock-in-1',
    clockOutEventId: null,
    clockOutAt: null,
    pauseMinutes: 10,
  })
  expect(portal.getLastEditBody()).not.toHaveProperty('reason')
})

test('manager can still close a running session with a corrected pause', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', null, 'open')
  const card = page.locator('.times-list > article').first()
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()

  const end = page.locator('[data-admin-time-end]')
  const pause = page.getByLabel('Pause in Minuten')
  await end.fill(`${portal.today}T08:00`)
  await pause.fill('10')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Laufender Dienst wurde korrigiert und abgeschlossen/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  await expect(card.getByText('0:50 Std.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({
    clockInEventId: 'clock-in-1',
    clockOutEventId: null,
    pauseMinutes: 10,
  })
  expect(portal.getLastEditBody().clockOutAt).toContain(`${portal.today}T08:00`)
  expect(portal.getLastEditBody()).not.toHaveProperty('reason')
})
