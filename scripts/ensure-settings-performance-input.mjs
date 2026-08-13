import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
const start = source.indexOf('function SettingsPage({ session }) {')
const end = source.indexOf('\n\nfunction UnifiedPortal', start)
assert.ok(start >= 0 && end > start, 'SettingsPage wurde für die Performance-Normalisierung nicht gefunden.')

const block = source.slice(start, end)
if (block.includes('peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)')) {
  console.log('Settings performance input already optimized')
  process.exit(0)
}

const before = `  const load = useCallback(async () => {\n    try {\n      const data = await apiJson('/api/company-settings')\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`
const after = `  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)\n      if (cached !== undefined) setForm((current) => ({ ...current, ...(cached.settings || {}) }))\n      const data = await refreshCachedJson(COMPANY_SETTINGS_CACHE_KEY, () => apiJson('/api/company-settings'), { ttlMs: COMPANY_SETTINGS_CACHE_TTL_MS })\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`

assert.ok(block.includes(before), 'Einstellungen-Ladung wurde in einer unbekannten Form gefunden.')
const nextBlock = block.replace(before, after)
source = source.slice(0, start) + nextBlock + source.slice(end)
await writeFile(path, source)
console.log('Settings cached-then-fresh loading prepared')
