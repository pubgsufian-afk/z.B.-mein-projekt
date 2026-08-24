import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const roots = ['public', 'frontend/src']
const allowedExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const ignoredDirectoryNames = new Set(['node_modules', 'dist', 'build', '.netlify'])

async function filesUnder(root) {
  const result = []
  async function walk(path) {
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue
      const full = join(path, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && allowedExtensions.has(extname(entry.name))) result.push(full)
    }
  }
  await walk(root)
  return result
}

function apiEndpoints(source) {
  const found = new Set()
  const pattern = /\/api\/[A-Za-z0-9_-]+/g
  for (const match of source.matchAll(pattern)) found.add(match[0])
  return found
}

const [registry, policy] = await Promise.all([
  readFile('ops/portal-admin-capabilities.json', 'utf8').then(JSON.parse),
  readFile('ops/portal-admin-surface-policy.json', 'utf8').then(JSON.parse),
])
const capabilityIds = new Set(registry.map((entry) => entry.id))
const coveredAliases = policy.coveredAliases || {}
const excluded = policy.excluded || {}

for (const [endpoint, ids] of Object.entries(coveredAliases)) {
  assert.ok(endpoint.startsWith('/api/'), `covered alias is not an API endpoint: ${endpoint}`)
  assert.ok(Array.isArray(ids) && ids.length, `covered alias has no capability ids: ${endpoint}`)
  for (const id of ids) assert.ok(capabilityIds.has(id), `covered alias ${endpoint} references missing capability ${id}`)
}
for (const [endpoint, reason] of Object.entries(excluded)) {
  assert.ok(endpoint.startsWith('/api/'), `excluded entry is not an API endpoint: ${endpoint}`)
  assert.ok(String(reason || '').trim().length >= 12, `excluded endpoint needs a concrete reason: ${endpoint}`)
}

const files = (await Promise.all(roots.map(filesUnder))).flat()
const endpointFiles = new Map()
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const endpoint of apiEndpoints(source)) {
    const list = endpointFiles.get(endpoint) || []
    list.push(relative('.', file))
    endpointFiles.set(endpoint, list)
  }
}

const uncovered = [...endpointFiles.entries()]
  .filter(([endpoint]) => !coveredAliases[endpoint] && !excluded[endpoint])
  .sort(([left], [right]) => left.localeCompare(right))

if (uncovered.length) {
  const detail = uncovered.map(([endpoint, paths]) => `${endpoint} <- ${paths.join(', ')}`).join('\n')
  assert.fail(`Unclassified portal API endpoints:\n${detail}`)
}

const staleCovered = Object.keys(coveredAliases).filter((endpoint) => !endpointFiles.has(endpoint))
const staleExcluded = Object.keys(excluded).filter((endpoint) => !endpointFiles.has(endpoint))
console.log(`portal admin surface coverage passed: scanned=${files.length} endpoints=${endpointFiles.size} covered=${Object.keys(coveredAliases).length} excluded=${Object.keys(excluded).length}`)
if (staleCovered.length) console.log(`portal admin surface coverage: policy-only covered aliases=${staleCovered.join(',')}`)
if (staleExcluded.length) console.log(`portal admin surface coverage: policy-only exclusions=${staleExcluded.join(',')}`)
