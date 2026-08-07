import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, replacements) {
  let source = await readFile(path, 'utf8')
  let changed = false
  for (const { from, to, multiple = false } of replacements) {
    if (source.includes(to)) continue
    const count = source.split(from).length - 1
    if (!count) throw new Error(`Scheduler-Patch: Marker fehlt in ${path}: ${from.slice(0, 90)}`)
    if (!multiple && count !== 1) throw new Error(`Scheduler-Patch: Marker ist nicht eindeutig in ${path}: ${count}`)
    source = multiple ? source.split(from).join(to) : source.replace(from, to)
    changed = true
  }
  if (changed) await writeFile(path, source)
  return changed
}

const changed = []

if (await patch('frontend/src/App.jsx', [
  {
    from: "  manager: 'Einsatzleiter',\n  employee: 'Mitarbeiter',",
    to: "  manager: 'Einsatzleiter',\n  scheduler: 'Dienstplan-Support',\n  employee: 'Mitarbeiter',",
  },
  {
    from: "const MANAGEMENT = new Set(['owner', 'admin', 'manager'])\nconst ADMINISTRATION",
    to: "const MANAGEMENT = new Set(['owner', 'admin', 'manager'])\nconst SCHEDULING = new Set([...MANAGEMENT, 'scheduler'])\nconst ADMINISTRATION",
  },
  {
    from: "{ key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager', 'employee'] },",
    to: "{ key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager', 'scheduler', 'employee'] },",
  },
  {
    from: "function SchedulePage({ session }) {\n  const management = MANAGEMENT.has(session.role)",
    to: "function SchedulePage({ session }) {\n  const management = SCHEDULING.has(session.role)",
  },
  {
    from: "if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson('/api/registrations'))",
    to: "if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson(session.role === 'scheduler' ? '/api/schedule-directory' : '/api/registrations'))",
  },
  {
    from: "<button className=\"secondary-button\" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>{busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF'}</button>",
    to: "{MANAGEMENT.has(session.role) && <button className=\"secondary-button\" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>{busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF'}</button>}",
  },
  {
    from: "const initialPage = session.role === 'employee' ? 'attendance' : 'overview'",
    to: "const initialPage = session.role === 'employee' ? 'attendance' : session.role === 'scheduler' ? 'schedule' : 'overview'",
  },
])) changed.push('frontend/src/App.jsx')

if (await patch('netlify/functions/_shared/portal-role.mts', [
  {
    from: "export type PortalRole = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'",
    to: "export type PortalRole = 'owner' | 'admin' | 'manager' | 'scheduler' | 'employee' | 'pending'",
  },
  {
    from: "const VALID_ROLES = new Set<PortalRole>(['owner', 'admin', 'manager', 'employee', 'pending'])",
    to: "const VALID_ROLES = new Set<PortalRole>(['owner', 'admin', 'manager', 'scheduler', 'employee', 'pending'])",
  },
  {
    from: "  const access = await getStore({ name: 'portal-access', consistency: 'strong' })",
    to: "  const schedulers = new Set((Netlify.env.get('PORTAL_SCHEDULER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))\n  const access = await getStore({ name: 'portal-access', consistency: 'strong' })",
  },
  {
    from: "  const role = owners.has(email)\n    ? 'owner'\n    : access?.status",
    to: "  const role = owners.has(email)\n    ? 'owner'\n    : schedulers.has(email)\n      ? 'scheduler'\n      : access?.status",
  },
])) changed.push('netlify/functions/_shared/portal-role.mts')

if (await patch('netlify/functions/session.mts', [
  {
    from: "import { proxyToProductionBackend } from \"./_shared/proxy.mts\";",
    to: "import { proxyToProductionBackend } from \"./_shared/proxy.mts\";\nimport { currentPortalActor } from \"./_shared/portal-role.mts\";",
  },
  {
    from: "export default async (request: Request, _context: Context) => {",
    to: "export default async (request: Request, _context: Context) => {\n  const local = await currentPortalActor();\n  if (local?.role === 'scheduler') {\n    return json({\n      userId: local.userId,\n      email: local.email,\n      fullName: String(local.user.userMetadata?.full_name || 'Dienstplan-Support'),\n      role: 'scheduler',\n    });\n  }",
  },
])) changed.push('netlify/functions/session.mts')

if (await patch('netlify/functions/schedule-v2.mts', [
  {
    from: "type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'",
    to: "type Role = 'owner' | 'admin' | 'manager' | 'scheduler' | 'employee' | 'pending'",
  },
  {
    from: "const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])\nconst STORE_NAME",
    to: "const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])\nconst SCHEDULING = new Set<Role>([...MANAGEMENT, 'scheduler'])\nconst STORE_NAME",
  },
  {
    from: "  const access = await accessStore().get(`access/${user.id}`",
    to: "  const schedulers = new Set((Netlify.env.get('PORTAL_SCHEDULER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))\n  const access = await accessStore().get(`access/${user.id}`",
  },
  {
    from: "  const role = owners.has(email)\n    ? 'owner'\n    : access?.status",
    to: "  const role = owners.has(email)\n    ? 'owner'\n    : schedulers.has(email)\n      ? 'scheduler'\n      : access?.status",
  },
  {
    from: "['owner', 'admin', 'manager', 'employee'].includes(value)",
    to: "['owner', 'admin', 'manager', 'scheduler', 'employee'].includes(value)",
  },
  {
    from: "  if (!MANAGEMENT.has(current.role)) {\n    entries = entries.filter",
    to: "  if (!SCHEDULING.has(current.role)) {\n    entries = entries.filter",
  },
  {
    from: "    if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)\n    if (resource === 'objects')",
    to: "    if (!SCHEDULING.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)\n    if (resource === 'objects')",
  },
  {
    from: "      if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)",
    to: "      if (!SCHEDULING.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)",
    multiple: true,
  },
  {
    from: "  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)\n  const body",
    to: "  if (!SCHEDULING.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)\n  const body",
  },
])) changed.push('netlify/functions/schedule-v2.mts')

if (await patch('netlify/functions/schedule-assist-v2.mts', [
  {
    from: "type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'",
    to: "type Role = 'owner' | 'admin' | 'manager' | 'scheduler' | 'employee' | 'pending'",
  },
  {
    from: "const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])",
    to: "const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])\nconst SCHEDULING = new Set<Role>([...MANAGEMENT, 'scheduler'])",
  },
  {
    from: "  const access = await getStore({ name: 'portal-access', consistency: 'strong' })",
    to: "  const schedulers = new Set((Netlify.env.get('PORTAL_SCHEDULER_EMAILS') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))\n  const access = await getStore({ name: 'portal-access', consistency: 'strong' })",
  },
  {
    from: "  const role = owners.has(email)\n    ? 'owner'\n    : access?.status",
    to: "  const role = owners.has(email)\n    ? 'owner'\n    : schedulers.has(email)\n      ? 'scheduler'\n      : access?.status",
  },
  {
    from: "['owner', 'admin', 'manager', 'employee'].includes(value)",
    to: "['owner', 'admin', 'manager', 'scheduler', 'employee'].includes(value)",
  },
  {
    from: "  if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)",
    to: "  if (!SCHEDULING.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)",
  },
])) changed.push('netlify/functions/schedule-assist-v2.mts')

if (await patch('tests/e2e/unified-portal.spec.mjs', [
  {
    from: "  employee: {\n    id: 'employee-anna'",
    to: "  scheduler: {\n    id: 'scheduler-1', email: 'dienstplan-support@example.test', aud: '', role: 'authenticated',\n    app_metadata: { provider: 'email', roles: ['scheduler'] },\n    user_metadata: { full_name: 'Dienstplan-Support' },\n    created_at: '2026-08-06T00:00:00.000Z', confirmed_at: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-06T00:00:00.000Z',\n  },\n  employee: {\n    id: 'employee-anna'",
  },
  {
    from: "  await page.route('**/api/registrations', async (route) => {",
    to: "  await page.route('**/api/schedule-directory', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ employees }) }))\n\n  await page.route('**/api/registrations', async (route) => {",
  },
  {
    from: "    if (role === 'employee') return route.fulfill({ status: 403",
    to: "    if (role === 'employee' || role === 'scheduler') return route.fulfill({ status: 403",
  },
  {
    from: "role === 'employee' ? 'Stempeluhr' : 'Übersicht'",
    to: "role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht'",
  },
  {
    from: "\ntest('employee sees only clock and own published schedule'",
    to: "\ntest('scheduler edits only the schedule without reports or exports', async ({ page }) => {\n  await login(page, 'scheduler')\n  await expect(page.getByRole('heading', { name: 'Dienstplan', exact: true })).toBeVisible()\n  await expect(page.getByRole('button', { name: 'Dienstplan', exact: true })).toBeVisible()\n  for (const forbidden of ['Übersicht', 'Zeiterfassung', 'Mitarbeiter', 'Zeiten', 'Einsatzorte', 'Korrekturen', 'Berichte', 'Einstellungen']) {\n    await expect(page.getByRole('button', { name: forbidden, exact: true })).toHaveCount(0)\n  }\n  await expect(page.getByRole('button', { name: 'Dienstplan als PDF' })).toHaveCount(0)\n  await expect(page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first()).toBeVisible()\n  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()\n  await expect(page.getByRole('heading', { exact: true, name: 'Dienst erstellen' })).toBeVisible()\n  await expectNoHorizontalPageOverflow(page)\n})\n\ntest('employee sees only clock and own published schedule'",
  },
])) changed.push('tests/e2e/unified-portal.spec.mjs')

console.log(changed.length ? `Scheduler support applied: ${changed.join(', ')}` : 'Scheduler support already applied')
