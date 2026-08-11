import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function ownerUser() {
  return {
    id: 'owner-timesheet-test', email: 'owner.timesheet@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['owner'] }, user_metadata: { full_name: 'Hauptadmin Stundenzettel' },
    created_at: '2026-08-11T00:00:00.000Z', confirmed_at: '2026-08-11T00:00:00.000Z', updated_at: '2026-08-11T00:00:00.000Z',
  }
}
function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now, app_metadata: user.app_metadata, user_metadata: user.user_metadata })}.test-signature`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user }
}
async function mockIdentity(page, user) {
  let authenticated = false
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    if (url.pathname.endsWith('/token') && request.method() === 'POST') { authenticated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(user)) }) }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? user : { error: 'invalid_token' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}
async function navigate(page, label) {
  const sidebar = page.locator('.sidebar'); const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) { await menu.click(); await expect(sidebar).toHaveClass(/open/) }
  const target = sidebar.getByRole('button', { name: label, exact: true }); await expect(target).toBeVisible(); await target.evaluate((button) => button.click())
  await expect(page.locator('.topbar h1')).toHaveText(label)
}

test('Stundenzettel reads persisted rows and never mixes attendance history', async ({ page }) => {
  const user = ownerUser(); await mockIdentity(page, user)
  let attendanceHistoryReads = 0
  let row = { id: 'ts-1', scheduleShiftId: 'shift-1', employeeUserId: 'employee-anna', employeeName: 'Anna Beispiel', workDate: '2026-08-10', start: '10:00', end: '17:00', pauseMinutes: 60, netMinutes: 360, location: 'Abbott', workArea: 'GMP', source: 'schedule', manualOverride: false }
  let updatedBody = null
  await page.route('**/api/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.user_metadata.full_name, role: 'owner' }) }))
  await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [{ userId: 'employee-anna', fullName: 'Anna Beispiel', location: 'Abbott' }], archived: [] }) }))
  await page.route('**/api/schedule-v2**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], objects: [] }) }))
  await page.route('**/api/attendance**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('resource') === 'history') attendanceHistoryReads += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) })
  })
  await page.route('**/api/timesheets**', async (route) => {
    if (route.request().method() === 'PATCH') {
      updatedBody = route.request().postDataJSON(); row = { ...row, start: updatedBody.start, source: 'manual', manualOverride: true }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: row }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [row], months: [{ month: '2026-08', correctionDeadline: '2026-09-10', scheduleSyncOpen: true }] }) })
  })

  await page.goto('/')
  await page.getByLabel('E-Mail-Adresse').fill(user.email); await page.getByLabel('Passwort').fill('TestPasswort123!'); await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.locator('.topbar h1')).toHaveText('Übersicht')
  await navigate(page, 'Stundenzettel')
  await expect(page.getByText('Anna Beispiel').last()).toBeVisible(); await expect(page.getByText('6:00 Std.', { exact: true })).toBeVisible()
  await expect.poll(() => attendanceHistoryReads).toBe(0)

  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  await page.getByLabel('Beginn').fill('09:00')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => updatedBody?.action).toBe('manual-update')
  expect(updatedBody.id).toBe('ts-1')
})
