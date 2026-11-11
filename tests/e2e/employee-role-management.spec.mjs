import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function userFor(role) {
  return {
    id: `${role}-role-test`, email: `${role}.roles@example.test`, aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: [role] },
    user_metadata: { full_name: role === 'owner' ? 'Hauptadmin Test' : 'Admin Test' },
    created_at: '2026-08-07T00:00:00.000Z', confirmed_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
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
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    if (url.pathname.endsWith('/token') && request.method() === 'POST') { authenticated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(user)) }) }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? user : { error: 'invalid_token' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}
async function mockPortal(page, actorRole, targetRole = 'employee', targetId = 'employee-adel') {
  const user = userFor(actorRole)
  let lastPatch = null, active = true, role = targetRole
  let fullName = targetId === user.id ? user.user_metadata.full_name : 'Adel Abdal'
  let company = 'Habun Security'
  let location = 'Abbott'
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role: actorRole }) }))
  await page.route('**/api/registrations', async (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      lastPatch = request.postDataJSON()
      if (lastPatch.action === 'update-role') role = lastPatch.role
      if (lastPatch.action === 'deactivate-account') active = false
      if (lastPatch.action === 'update-profile') {
        fullName = lastPatch.fullName
        company = lastPatch.company
        location = lastPatch.location
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, employee: { userId: targetId, fullName, company, location, role, status: active ? 'active' : 'inactive' }, role, deactivated: !active }) })
    }
    const employee = { userId: targetId, fullName, company, location, role, status: active ? 'active' : 'inactive' }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: active ? [employee] : [], archived: active ? [] : [employee] }) })
  })
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [], entries: [] }) }))
  return { user, getLastPatch: () => lastPatch }
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
async function openEmployees(page, actorRole, targetRole = 'employee', targetId = 'employee-adel') {
  const portal = await mockPortal(page, actorRole, targetRole, targetId)
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await navigate(page, 'Mitarbeiter')
  return portal
}

test('Hauptadmin may assign Admin and deactivate normal accounts', async ({ page }) => {
  const portal = await openEmployees(page, 'owner')
  const select = page.getByLabel('Rolle für Adel Abdal')
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="admin"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Konto deaktivieren' })).toBeVisible()
  await select.selectOption('manager')
  await expect(select).toHaveValue('manager')
  await page.getByRole('button', { name: 'Rolle ändern' }).click()
  await expect.poll(() => portal.getLastPatch()).toMatchObject({ id: 'employee-adel', action: 'update-role', role: 'manager' })
})

test('normal Admin may switch Mitarbeiter and Einsatzleiter but never assign Admin', async ({ page }) => {
  await openEmployees(page, 'admin', 'employee')
  const select = page.getByLabel('Rolle für Adel Abdal')
  await expect(select.locator('option[value="employee"]')).toHaveCount(1)
  await expect(select.locator('option[value="manager"]')).toHaveCount(1)
  await expect(select.locator('option[value="admin"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Konto deaktivieren' })).toBeVisible()
})

test('normal Admin cannot change or deactivate another Admin', async ({ page }) => {
  await openEmployees(page, 'admin', 'admin')
  await expect(page.getByText('Nur Hauptadmin darf Admin-Konten ändern.')).toBeVisible()
  await expect(page.getByLabel('Rolle für Adel Abdal')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Konto deaktivieren' })).toHaveCount(0)
})

test('Hauptadmin own account stays protected', async ({ page }) => {
  const portal = await mockPortal(page, 'owner', 'owner', 'owner-role-test')
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await navigate(page, 'Mitarbeiter')
  await expect(page.getByText('Hauptadmin ist geschützt.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Konto deaktivieren' })).toHaveCount(0)
})

test('Hauptadmin can edit employee profile data', async ({ page }) => {
  const portal = await openEmployees(page, 'owner')
  await page.getByRole('button', { name: 'Daten bearbeiten' }).click()
  await page.getByLabel('Name für Adel Abdal').fill('Adel Neu')
  await page.getByLabel('Firma für Adel Abdal').fill('Habun Security')
  await page.getByLabel('Einsatzort für Adel Abdal').fill('GMB')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => portal.getLastPatch()).toMatchObject({
    id: 'employee-adel', action: 'update-profile', fullName: 'Adel Neu', company: 'Habun Security', location: 'GMB',
  })
  await expect(page.locator('.employee-grid article').first()).toContainText('Adel Neu')
  await expect(page.locator('.employee-grid article').first()).toContainText('GMB')
})

test('Hauptadmin can edit own profile while role and deactivation stay protected', async ({ page }) => {
  const portal = await mockPortal(page, 'owner', 'owner', 'owner-role-test')
  await mockIdentity(page, portal.user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(portal.user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await navigate(page, 'Mitarbeiter')
  await expect(page.getByRole('button', { name: 'Daten bearbeiten' })).toBeVisible()
  await page.getByRole('button', { name: 'Daten bearbeiten' }).click()
  await page.getByLabel('Name für Hauptadmin Test').fill('Hauptadmin Neu')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => portal.getLastPatch()).toMatchObject({ id: 'owner-role-test', action: 'update-profile', fullName: 'Hauptadmin Neu' })
  await expect(page.getByText('Hauptadmin ist geschützt.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Konto deaktivieren' })).toHaveCount(0)
})

test('normal Admin has no profile edit action', async ({ page }) => {
  await openEmployees(page, 'admin')
  await expect(page.getByRole('button', { name: 'Daten bearbeiten' })).toHaveCount(0)
})


async function openDuplicateKwameAccounts(page, actorRole) {
  const user = userFor(actorRole)
  const patches = []
  await page.route('**/api/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role: actorRole }),
  }))
  await page.route('**/api/registrations', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      patches.push(body)
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(body.action === 'preview-kwame-schedule-transfer'
          ? { ok: true, preview: true, shiftCount: 5, publishedCount: 3, firstDate: '2026-11-02', lastDate: '2026-11-20', conflicts: [], moved: 0 }
          : { ok: true, preview: false, shiftCount: 5, moved: 5 }),
      })
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        requests: [], archived: [],
        employees: [
          { userId: 'old-user-12', fullName: '12', role: 'employee', status: 'active', company: 'Habun Security', location: 'Abbott' },
          { userId: 'correct-kwame-login', fullName: 'Kwame Akakpo', role: 'employee', status: 'active', company: 'Habun Security', location: 'Abbott' },
        ],
      }),
    })
  })
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], schedules: [], entries: [] }) }))
  await mockIdentity(page, user)
  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await navigate(page, 'Mitarbeiter')
  return patches
}

test('only Hauptadmin can preview and confirm shift transfer from 12 to real Kwame ID', async ({ page }) => {
  const patches = await openDuplicateKwameAccounts(page, 'owner')
  const button = page.getByRole('button', { name: 'Dienstpläne zu Kwame Akakpo übertragen' })
  await expect(button).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  await button.click()
  await expect.poll(() => patches.map((entry) => entry.action)).toEqual([
    'preview-kwame-schedule-transfer', 'confirm-kwame-schedule-transfer',
  ])
  expect(patches[0]).toMatchObject({ sourceUserId: 'old-user-12', targetUserId: 'correct-kwame-login' })
  expect(patches[1]).toMatchObject({ sourceUserId: 'old-user-12', targetUserId: 'correct-kwame-login' })
})

test('normal Admin cannot transfer duties between accounts', async ({ page }) => {
  await openDuplicateKwameAccounts(page, 'admin')
  await expect(page.getByRole('button', { name: 'Dienstpläne zu Kwame Akakpo übertragen' })).toHaveCount(0)
})
