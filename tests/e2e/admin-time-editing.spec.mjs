import { expect, test } from '@playwright/test'
import { attachAccess, attachIdentity, portalJson, registerPortalMocks } from './support/portal-mocks.mjs'

const ADMIN = { id: 'admin-1', email: 'admin@example.com', user_metadata: { full_name: 'Admin Test' }, app_metadata: { roles: ['admin'] } }
const MANAGER = { id: 'manager-1', email: 'manager@example.com', user_metadata: { full_name: 'Manager Test' }, app_metadata: { roles: ['manager'] } }

async function mockIdentity(page, user) {
  await attachIdentity(page, user)
  await attachAccess(page, user, user.app_metadata.roles[0])
}

async function mockPortal(page, role, initialPauseAdjustment = null, mode = 'completed') {
  const user = role === 'admin' ? ADMIN : MANAGER
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
  const clockInAt = `${today}T06:00:00.000Z`
  const clockOutAt = mode === 'open' ? '' : `${today}T07:00:00.000Z`
  let lastEditBody = null
  const entries = [
    {
      id: 'clock-in-1', userId: 'employee-1', userName: 'Mitarbeiter Eins', action: 'clock-in',
      clientOccurredAt: clockInAt, serverReceivedAt: clockInAt, objectId: 'site-1', scheduleId: 'shift-1',
      locationStatus: 'inside', location: { latitude: 52.3, longitude: 9.7, accuracyMeters: 10 },
    },
    ...(mode === 'open' ? [] : [{
      id: 'clock-out-1', userId: 'employee-1', userName: 'Mitarbeiter Eins', action: 'clock-out',
      clientOccurredAt: clockOutAt, serverReceivedAt: clockOutAt, objectId: 'site-1', scheduleId: 'shift-1',
      locationStatus: 'inside', location: { latitude: 52.3, longitude: 9.7, accuracyMeters: 10 },
    }]),
  ]
  if (initialPauseAdjustment != null) {
    entries.push({
      id: 'adjustment-1', userId: 'employee-1', userName: 'Mitarbeiter Eins', action: 'adjustment',
      clientOccurredAt: `${today}T07:01:00.000Z`, serverReceivedAt: `${today}T07:01:00.000Z`,
      adjustment: { pauseMinutes: initialPauseAdjustment, reason: 'Bestehende Korrektur' },
    })
  }

  await registerPortalMocks(page, { user, role })
  await page.route('**/api/session', async (route) => route.fulfill(portalJson({
    authenticated: true,
    user: { id: user.id, email: user.email, fullName: user.user_metadata.full_name, role },
  })))
  await page.route('**/api/attendance-time-edit', async (route) => {
    lastEditBody = route.request().postDataJSON()
    if (lastEditBody?.endAt && !entries.some((entry) => entry.action === 'clock-out')) {
      entries.push({
        id: 'clock-out-created', userId: 'employee-1', userName: 'Mitarbeiter Eins', action: 'clock-out',
        clientOccurredAt: lastEditBody.endAt, serverReceivedAt: lastEditBody.endAt,
        objectId: 'site-1', scheduleId: 'shift-1', locationStatus: 'inside',
      })
    }
    const adjustment = entries.find((entry) => entry.action === 'adjustment')
    if (adjustment) adjustment.adjustment = { pauseMinutes: Number(lastEditBody?.pauseMinutes || 0), reason: lastEditBody?.reason || '' }
    else entries.push({
      id: 'adjustment-created', userId: 'employee-1', userName: 'Mitarbeiter Eins', action: 'adjustment',
      clientOccurredAt: `${today}T08:01:00.000Z`, serverReceivedAt: `${today}T08:01:00.000Z`,
      adjustment: { pauseMinutes: Number(lastEditBody?.pauseMinutes || 0), reason: lastEditBody?.reason || '' },
    })
    return route.fulfill(portalJson({ message: mode === 'open' ? 'Laufender Dienst wurde korrigiert und abgeschlossen.' : 'Arbeitszeit wurde aktualisiert.' }))
  })
  await page.route('**/api/attendance?**', async (route) => {
    const url = new URL(route.request().url())
    const resource = url.searchParams.get('resource')
    if (resource === 'history') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) })
    if (resource === 'live') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [] }) })
  })
  await page.route('**/api/attendance', async (route) => {
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
    clockInEventId: 'clock-in-1',
    clockOutEventId: 'clock-out-1',
    pauseMinutes: 15,
    reason: 'Korrektur durch Admin',
  })
})

test('manager can directly edit a completed employee session', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', 20)
  const card = page.locator('.times-list > article').first()
  await expect(card.getByText('20 Min.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await page.getByLabel('Pause in Minuten').fill('10')
  await page.getByLabel('Begründung').fill('Korrektur durch Einsatzleiter')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Arbeitszeit wurde aktualisiert/)).toBeVisible()
  await expect(card.getByText('10 Min.', { exact: true })).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({ pauseMinutes: 10, reason: 'Korrektur durch Einsatzleiter' })
})

test('manager can edit an already checked-in running session and close it with pause', async ({ page }) => {
  const portal = await loginAndOpenTimes(page, 'manager', null, 'open')
  const card = page.locator('.times-list > article').first()
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  const end = page.getByLabel('Ende')
  const pause = page.getByLabel('Pause in Minuten')
  await expect(end).toHaveValue('')
  await expect(pause).toHaveJSProperty('readOnly', true)

  await end.fill(`${portal.today}T08:00`)
  await expect(pause).toHaveJSProperty('readOnly', false)
  await pause.fill('10')
  await page.getByLabel('Begründung').fill('Laufenden Dienst korrigiert')
  await page.getByRole('button', { name: 'Änderung speichern', exact: true }).click()

  await expect(page.getByText(/Laufender Dienst wurde korrigiert und abgeschlossen/)).toBeVisible()
  expect(portal.getLastEditBody()).toMatchObject({ pauseMinutes: 10, reason: 'Laufenden Dienst korrigiert' })
})
