import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function ownerUser() {
  return {
    id: 'owner-performance-test', email: 'owner.performance@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['owner'] },
    user_metadata: { full_name: 'Hauptadmin Performance' },
    created_at: '2026-08-09T00:00:00.000Z', confirmed_at: '2026-08-09T00:00:00.000Z', updated_at: '2026-08-09T00:00:00.000Z',
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

async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  const target = sidebar.getByRole('button', { name: label, exact: true })
  await expect(target).toBeVisible()
  await target.evaluate((button) => button.click())
  await expect(page.locator('.topbar h1')).toHaveText(label)
}

async function loginOwner(page, setupRoutes) {
  const user = ownerUser()
  await mockIdentity(page, user)
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role: 'owner' }) }))
  await setupRoutes(user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Übersicht')
}

test('Übersicht requests only the current day schedule range', async ({ page }) => {
  const overviewRanges = []

  await loginOwner(page, async () => {
    await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [], archived: [] }) }))
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
    await page.route('**/api/schedule-v2**', (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('resource') === 'entries') overviewRanges.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to') })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) })
    })
  })

  await expect.poll(() => overviewRanges.length).toBeGreaterThanOrEqual(1)
  expect(overviewRanges[0].from).toBeTruthy()
  expect(overviewRanges[0].from).toBe(overviewRanges[0].to)
})

test('Mitarbeiter controls reuse the React directory instead of adding another GET', async ({ page }) => {
  let registrationGets = 0

  await loginOwner(page, async () => {
    await page.route('**/api/registrations', async (route) => {
      if (route.request().method() === 'GET') registrationGets += 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requests: [],
          employees: [{ userId: 'employee-adel', fullName: 'Adel Abdal', company: 'Habun Security', location: 'Abbott', role: 'employee', status: 'active' }],
          archived: [],
        }),
      })
    })
    await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
  })

  await navigate(page, 'Mitarbeiter')
  await expect(page.getByRole('button', { name: 'Daten bearbeiten' })).toBeVisible()
  await expect(page.getByLabel('Rolle für Adel Abdal')).toBeVisible()
  await expect.poll(() => registrationGets).toBeLessThanOrEqual(2)
  await expect(page.locator('.employee-grid article[data-user-id="employee-adel"]')).toContainText('Adel Abdal')
})

test('Dienstplan entries remain fresh and isolated for each week', async ({ page }) => {
  const requestedWeeks = []

  await loginOwner(page, async () => {
    await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [{ userId: 'employee-adel', fullName: 'Adel Abdal', location: 'Abbott', role: 'employee', status: 'active' }], archived: [] }) }))
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
    await page.route('**/api/schedule-v2**', async (route) => {
      const url = new URL(route.request().url())
      const resource = url.searchParams.get('resource')
      if (resource === 'entries') {
        const from = url.searchParams.get('from')
        requestedWeeks.push(from)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [{ id: `shift-${from}`, employeeUserId: 'employee-adel', employeeName: 'Adel Abdal', date: from, start: '07:00', end: '17:00', pauseMinutes: 30, location: 'Abbott', workArea: 'ZuKo', status: 'published' }] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) })
    })
  })

  await navigate(page, 'Dienstplan')
  await expect.poll(() => requestedWeeks.length).toBeGreaterThanOrEqual(1)
  const firstWeek = requestedWeeks.at(-1)
  await page.getByRole('button', { name: 'Nächste ›' }).click()
  await expect.poll(() => new Set(requestedWeeks.filter(Boolean)).size).toBeGreaterThanOrEqual(2)
  const secondWeek = requestedWeeks.at(-1)
  expect(secondWeek).not.toBe(firstWeek)
  await expect(page.getByText('Adel Abdal').first()).toBeVisible()
})

test('Dienstplan entries render while editor directories are still loading', async ({ page }) => {
  let releaseDirectories
  const directoryGate = new Promise((resolve) => { releaseDirectories = resolve })

  await loginOwner(page, async () => {
    await page.route('**/api/registrations', async (route) => {
      await directoryGate
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: [], employees: [{ userId: 'employee-adel', fullName: 'Adel Abdal', location: 'Abbott', role: 'employee', status: 'active' }], archived: [] }),
      })
    })
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
    await page.route('**/api/schedule-v2**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('resource') === 'entries') {
        const from = url.searchParams.get('from')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ entries: [{ id: 'shift-fast-render', employeeUserId: 'employee-adel', employeeName: 'Adel Abdal', date: from, start: '07:00', end: '17:00', pauseMinutes: 30, location: 'Abbott', workArea: 'ZuKo', status: 'published' }] }),
        })
      }
      await directoryGate
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) })
    })
  })

  await navigate(page, 'Dienstplan')
  await expect(page.getByText('Adel Abdal').first()).toBeVisible({ timeout: 1500 })
  releaseDirectories()
  await expect(page.getByText('Abbott').first()).toBeVisible()
})

test('Einsatzorte show cached stable data while a fresh refresh is delayed', async ({ page }) => {
  let objectGets = 0
  let releaseSecondObjectRead
  const secondReadGate = new Promise((resolve) => { releaseSecondObjectRead = resolve })

  await loginOwner(page, async () => {
    await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [], archived: [] }) }))
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
    await page.route('**/api/schedule-v2**', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('resource') === 'objects') {
        objectGets += 1
        if (objectGets >= 2) await secondReadGate
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [{ id: 'site-abbott', name: 'Abbott', address: 'Teststraße 1', latitude: 52.1, longitude: 9.7, radiusMeters: 500 }] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) })
    })
  })

  await navigate(page, 'Einsatzorte')
  await expect(page.getByText('Abbott').first()).toBeVisible()
  await navigate(page, 'Übersicht')
  await navigate(page, 'Einsatzorte')
  await expect(page.getByText('Abbott').first()).toBeVisible({ timeout: 500 })
  releaseSecondObjectRead()
  await expect.poll(() => objectGets).toBeGreaterThanOrEqual(2)
})
