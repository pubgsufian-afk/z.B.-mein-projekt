import { readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const functionsDir = 'netlify/functions'
for (const name of await readdir(functionsDir)) {
  if (name.startsWith('audit-browser-') && name.endsWith('.mts')) {
    await rm(`${functionsDir}/${name}`)
  }
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  })
}

let stage = 'install'
let result = run('npx', ['playwright', 'install', 'chromium'])
let details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()

if (result.status === 0) {
  stage = 'prepare'
  result = run('node', ['scripts/prepare-unified-e2e.mjs'])
  details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

if (result.status === 0) {
  stage = 'tests'
  result = run('npx', ['playwright', 'test', 'tests/e2e/unified-portal.spec.mjs', '--reporter=json'])
  details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

const success = result.status === 0
const marker = success ? 'audit-browser-success' : `audit-browser-failed-${stage}`
const safeDetails = details.slice(-12000)
const payload = {
  success,
  stage,
  exitCode: result.status,
  checkedDevices: ['desktop-chromium', 'iphone-chromium', 'android-chromium'],
  expectedTests: 24,
  details: safeDetails,
}

await writeFile(`${functionsDir}/${marker}.mts`, `import type { Config } from '@netlify/functions'\n\nexport default async () => Response.json(${JSON.stringify(payload)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\n\nexport const config: Config = { path: '/api/${marker}' }\n`)
console.log(`Browser audit marker: ${marker}`)
