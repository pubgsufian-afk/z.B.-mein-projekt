import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
let changed = false

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  source = source.replace(before, after)
  changed = true
}

function ensureAfter(anchor, addition, marker, label) {
  if (source.includes(marker)) return
  assert.ok(source.includes(anchor), `${label}: Import-/Einfügeanker fehlt`)
  source = source.replace(anchor, `${anchor}${addition}`)
  changed = true
}

ensureAfter(
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n",
  "import { clearReadCache, invalidateCachedJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n",
  "from './read-cache.js'",
  'Read-cache import',
)

ensureAfter(
  "const ADMINISTRATION = new Set(['owner', 'admin'])\n",
  "\nconst REGISTRATIONS_CACHE_KEY = '/api/registrations'\nconst REGISTRATIONS_CACHE_TTL_MS = 15000\n",
  'REGISTRATIONS_CACHE_KEY',
  'Registrations cache constants',
)

replaceOnce(
  "        if (MANAGEMENT.has(session.role)) calls.push(apiJson('/api/registrations'))",
  "        if (MANAGEMENT.has(session.role)) calls.push(refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS }))",
  'Overview registrations request',
)

replaceOnce(
  `  const load = useCallback(async () => {\n    try {\n      const data = await apiJson('/api/attendance?resource=state')\n      setState(data)\n      if (MANAGEMENT.has(session.role)) {\n        const liveData = await apiJson('/api/attendance?resource=live')\n        setLive(liveData.entries || [])\n      }\n      setNotice(null)\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [session.role])`,
  `  const load = useCallback(async () => {\n    try {\n      const calls = [apiJson('/api/attendance?resource=state')]\n      if (MANAGEMENT.has(session.role)) calls.push(apiJson('/api/attendance?resource=live'))\n      const [data, liveData] = await Promise.all(calls)\n      setState(data)\n      if (MANAGEMENT.has(session.role)) setLive(liveData?.entries || [])\n      setNotice(null)\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [session.role])`,
  'Attendance parallel reads',
)

replaceOnce(
  `  const canManage = ADMINISTRATION.has(session.role)\n  const load = useCallback(async () => {\n    try { setData(await apiJson('/api/registrations')); setNotice(null) }\n    catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [])`,
  `  const canManage = ADMINISTRATION.has(session.role)\n  const publishSnapshot = useCallback((next) => {\n    setData(next)\n    window.dispatchEvent(new CustomEvent('habun:employee-snapshot', {\n      detail: {\n        session: { role: session.role, userId: session.userId },\n        employees: Array.isArray(next.employees) ? next.employees : [],\n      },\n    }))\n  }, [session.role, session.userId])\n  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)\n      if (cached !== undefined) publishSnapshot(cached)\n      const fresh = await refreshCachedJson(\n        REGISTRATIONS_CACHE_KEY,\n        () => apiJson('/api/registrations'),\n        { ttlMs: REGISTRATIONS_CACHE_TTL_MS },\n      )\n      publishSnapshot(fresh)\n      setNotice(null)\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [publishSnapshot])`,
  'Employees cached-then-fresh load',
)

replaceOnce(
  `      await apiJson('/api/registrations', { method: 'PATCH', body: JSON.stringify({ id, action, role }) })\n      setNotice({ tone: 'success', text: action === 'approve' ? 'Konto wurde freigeschaltet.' : 'Anfrage wurde abgelehnt.' })\n      await load()`,
  `      await apiJson('/api/registrations', { method: 'PATCH', body: JSON.stringify({ id, action, role }) })\n      invalidateCachedJson(REGISTRATIONS_CACHE_KEY)\n      setNotice({ tone: 'success', text: action === 'approve' ? 'Konto wurde freigeschaltet.' : 'Anfrage wurde abgelehnt.' })\n      await load()`,
  'Employee write cache invalidation',
)

replaceOnce(
  `<article key={employee.userId || employee.id}><div className="avatar">`,
  `<article key={employee.userId || employee.id} data-user-id={employee.userId || employee.id}><div className="avatar">`,
  'Stable employee card id',
)

replaceOnce(
  `      const calls = [apiJson(\`/api/schedule-v2?resource=entries&from=\${from}&to=\${to}\`)]\n      if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson(session.role === 'scheduler' ? '/api/schedule-directory' : '/api/registrations'))\n      const [shiftData, objectData, employeeData] = await Promise.all(calls)`,
  `      // Scheduler patch compatibility: if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson(session.role === 'scheduler' ? '/api/schedule-directory' : '/api/registrations'))\n      const employeeDirectoryUrl = session.role === 'scheduler' ? '/api/schedule-directory' : '/api/registrations'\n      const cachedEmployees = session.role === 'scheduler' ? undefined : peekCachedJson(REGISTRATIONS_CACHE_KEY)\n      if (cachedEmployees !== undefined) setEmployees(cachedEmployees.employees || [])\n      const calls = [apiJson(\`/api/schedule-v2?resource=entries&from=\${from}&to=\${to}\`)]\n      if (management) {\n        calls.push(\n          apiJson('/api/schedule-v2?resource=objects'),\n          session.role === 'scheduler'\n            ? apiJson(employeeDirectoryUrl)\n            : refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson(employeeDirectoryUrl), { ttlMs: REGISTRATIONS_CACHE_TTL_MS }),\n        )\n      }\n      const [shiftData, objectData, employeeData] = await Promise.all(calls)`,
  'Schedule fresh entries and cached directory',
)

replaceOnce(
  `  }, [week, management])`,
  `  }, [week, management, session.role])`,
  'Schedule load dependencies',
)

replaceOnce(
  `  const loadSession = useCallback(async (user) => {\n    if (!user) { setSession(null); setLoading(false); return }\n    try { setSession(await apiJson('/api/session')) }\n    catch (error) { setNotice({ tone: 'error', text: error.message }) }\n    finally { setLoading(false) }\n  }, [])`,
  `  const loadSession = useCallback(async (user) => {\n    clearReadCache()\n    if (!user) { setSession(null); setLoading(false); return }\n    try {\n      const nextSession = await apiJson('/api/session')\n      setSession(nextSession)\n      if (MANAGEMENT.has(nextSession.role)) {\n        refreshCachedJson(\n          REGISTRATIONS_CACHE_KEY,\n          () => apiJson('/api/registrations'),\n          { ttlMs: REGISTRATIONS_CACHE_TTL_MS },\n        ).catch(() => {})\n      }\n    }\n    catch (error) { setNotice({ tone: 'error', text: error.message }) }\n    finally { setLoading(false) }\n  }, [])`,
  'Login session prefetch',
)

replaceOnce(
  `  async function signOut() { await logout(); setIdentityUser(null); setSession(null) }`,
  `  async function signOut() { clearReadCache(); await logout(); setIdentityUser(null); setSession(null) }`,
  'Logout cache clear',
)

if (changed) await writeFile(path, source)
console.log(changed ? 'Safe portal performance loading applied' : 'Safe portal performance loading already applied')
