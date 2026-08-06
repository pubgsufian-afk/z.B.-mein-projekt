import { readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const functionsDir = 'netlify/functions'
for (const name of await readdir(functionsDir)) {
  if ((name.startsWith('audit-browser-') || name.startsWith('audit-fail-')) && name.endsWith('.mts')) {
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

function collectFailures(report) {
  const failures = []
  const visitSuite = (suite, parents = []) => {
    const nextParents = suite.title ? [...parents, suite.title] : parents
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const failed = (test.results || []).some((entry) => !['passed', 'skipped'].includes(entry.status))
        if (failed || test.status === 'unexpected') {
          failures.push({
            project: String(test.projectName || 'browser'),
            title: [...nextParents, spec.title].filter(Boolean).join(' > '),
          })
        }
      }
    }
    for (const child of suite.suites || []) visitSuite(child, nextParents)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  return failures
}

function compactProject(value) {
  if (value.includes('desktop')) return 'desktop'
  if (value.includes('iphone')) return 'iphone'
  if (value.includes('android')) return 'android'
  return 'browser'
}

function compactTest(value) {
  const title = value.toLowerCase()
  if (title.includes('reports provide')) return 'reports-downloads'
  if (title.includes('scheduler edits')) return 'scheduler-access'
  if (title.includes('admin uses')) return 'admin-settings'
  if (title.includes('digital attendance')) return 'attendance-flow'
  if (title.includes('mobile schedule')) return 'schedule-editor'
  if (title.includes('employee sees')) return 'employee-access'
  if (title.includes('management records')) return 'management-times'
  if (title.includes('login')) return 'login'
  return 'other'
}

let stage = 'install'
let result = run('npx', ['playwright', 'install', 'chromium'])
let details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
let failures = []

if (result.status === 0) {
  stage = 'prepare'
  result = run('node', ['scripts/prepare-unified-e2e.mjs'])
  details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
}

if (result.status === 0) {
  stage = 'tests'
  result = run('npx', ['playwright', 'test', 'tests/e2e/unified-portal.spec.mjs', '--reporter=json'])
  details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  try {
    failures = collectFailures(JSON.parse(result.stdout || '{}'))
  } catch {
    failures = []
  }
}

const success = result.status === 0
const marker = success ? 'audit-browser-success-24' : `audit-browser-failed-${stage}-${failures.length || 'unknown'}`
const safeDetails = details.slice(-12000)
const payload = {
  success,
  stage,
  exitCode: result.status,
  checkedDevices: ['desktop-chromium', 'iphone-chromium', 'android-chromium'],
  expectedTests: 24,
  failures,
  details: safeDetails,
}

const createMarker = async (name, data) => {
  await writeFile(`${functionsDir}/${name}.mts`, `import type { Config } from '@netlify/functions'\n\nexport default async () => Response.json(${JSON.stringify(data)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\n\nexport const config: Config = { path: '/api/${name}' }\n`)
}

await createMarker(marker, payload)
for (const failure of failures) {
  const name = `audit-fail-${compactProject(failure.project)}-${compactTest(failure.title)}`
  await createMarker(name, failure)
}
console.log(`Browser audit marker: ${marker}`)
