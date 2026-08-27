import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')

const responseGuard = "  if (!response.ok) {\n"
const responseGuardFixed = "  if (!response.ok) {\n    if (response.status === 401) window.dispatchEvent(new CustomEvent('habun:auth-expired'))\n"
if (!source.includes("habun:auth-expired")) {
  assert.ok(source.includes(responseGuard), 'apiJson response guard not found')
  source = source.replace(responseGuard, responseGuardFixed)
}

const staleCatch = "    try { setSession(await apiJson('/api/session')) }\n    catch (error) { setNotice({ tone: 'error', text: error.message }) }\n    finally { setLoading(false) }"
const fixedCatch = "    try { setSession(await apiJson('/api/session')) }\n    catch (error) {\n      if (error.status === 401) {\n        setIdentityUser(null)\n        setSession(null)\n        setNotice({ tone: 'error', text: 'Sitzung abgelaufen. Bitte erneut anmelden.' })\n      } else setNotice({ tone: 'error', text: error.message })\n    }\n    finally { setLoading(false) }"
if (!source.includes("error.status === 401")) {
  assert.ok(source.includes(staleCatch), 'loadSession stale-session catch not found')
  source = source.replace(staleCatch, fixedCatch)
}

const effectStart = "  useEffect(() => {\n    let unsubscribe = () => {}"
const effectStartFixed = "  useEffect(() => {\n    const onAuthExpired = () => {\n      setIdentityUser(null)\n      setSession(null)\n      setNotice({ tone: 'error', text: 'Sitzung abgelaufen. Bitte erneut anmelden.' })\n    }\n    window.addEventListener('habun:auth-expired', onAuthExpired)\n    let unsubscribe = () => {}"
if (!source.includes("window.addEventListener('habun:auth-expired'")) {
  assert.ok(source.includes(effectStart), 'App auth effect start not found')
  source = source.replace(effectStart, effectStartFixed)
}

const cleanup = "    return () => unsubscribe()\n  }, [loadSession])"
const cleanupFixed = "    return () => {\n      window.removeEventListener('habun:auth-expired', onAuthExpired)\n      unsubscribe()\n    }\n  }, [loadSession])"
if (!source.includes("removeEventListener('habun:auth-expired'")) {
  assert.ok(source.includes(cleanup), 'App auth effect cleanup not found')
  source = source.replace(cleanup, cleanupFixed)
}

await writeFile(path, source)
console.log('Expired session handling applied')
