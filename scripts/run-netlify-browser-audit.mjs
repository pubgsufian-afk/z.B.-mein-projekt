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
        const results = test.results || []
        const failed = results.some((entry) => !['passed', 'skipped'].includes(entry.status))
        if (failed || test.status === 'unexpected') {
          const error = results.flatMap((entry) => entry.errors || (entry.error ? [entry.error] : []))
            .map((entry) => String(entry?.message || entry?.value || entry || ''))
            .join(' ')
          failures.push({
            project: String(test.projectName || 'browser'),
            title: [...nextParents, spec.title].filter(Boolean).join(' > '),
            error,
          })
        }
      }
    }
    for (const child of suite.suites || []) visitSuite(child, nextParents)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  return failures
}

function projectCode(value) {
  if (value.includes('desktop')) return 'd'
  if (value.includes('iphone')) return 'i'
  if (value.includes('android')) return 'a'
  return 'b'
}

function testCode(value) {
  const title = value.toLowerCase()
  if (title.includes('reports preview')) return 'preview'
  if (title.includes('reports pdf download')) return 'pdf'
  if (title.includes('reports excel download')) return 'excel'
  if (title.includes('scheduler sees')) return 'support-access'
  if (title.includes('scheduler opens')) return 'support-editor'
  if (title.includes('admin uses')) return 'settings'
  if (title.includes('digital attendance')) return 'clock'
  if (title.includes('mobile schedule')) return 'schedule'
  if (title.includes('employee sees')) return 'employee'
  if (title.includes('management records')) return 'times'
  if (title.includes('registration')) return 'register'
  return 'other'
}

function errorCode(value) {
  const error = String(value || '').toLowerCase()
  if (error.includes('waiting for event "download"') || (error.includes('waitforevent') && error.includes('download'))) return 'download-event'
  if (error.includes('pdf-vorschau')) return 'preview'
  if (error.includes('dienst erstellen')) return 'editor-heading'
  if (error.includes('dienstplan als pdf')) return 'pdf-rights'
  if (error.includes('horizontal') || error.includes('scrollwidth')) return 'overflow'
  if (error.includes('strict mode violation')) return 'duplicate-locator'
  if (error.includes('timed out')) return 'timeout'
  return 'assertion'
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
  stage = 'split'
  result = run('node', ['scripts/split-browser-audit-tests.mjs'])
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
const failurePattern = [...new Set(failures.map((failure) => `${projectCode(failure.project)}-${testCode(failure.title)}-${errorCode(failure.error)}`))].join('-') || 'unparsed'
const marker = success ? 'audit-browser-success-33' : `audit-browser-failed-${stage}-${failures.length || 'unknown'}-${failurePattern}`
const safeDetails = details.slice(-12000)
const payload = {
  success,
  stage,
  exitCode: result.status,
  checkedDevices: ['desktop-chromium', 'iphone-chromium', 'android-chromium'],
  expectedTests: 33,
  failures,
  details: safeDetails,
}

await writeFile(`${functionsDir}/${marker}.mts`, `import type { Config } from '@netlify/functions'\n\nexport default async () => Response.json(${JSON.stringify(payload)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\n\nexport const config: Config = { path: '/api/${marker}' }\n`)
console.log(`Browser audit marker: ${marker}`)
