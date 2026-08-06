import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const functionsDir = 'netlify/functions'
const testPath = 'tests/e2e/unified-portal.spec.mjs'

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
        if (!failed && test.status !== 'unexpected') continue
        const error = results
          .flatMap((entry) => entry.errors || (entry.error ? [entry.error] : []))
          .map((entry) => String(entry?.message || entry?.value || entry || ''))
          .join(' ')
        failures.push({ project: String(test.projectName || 'browser'), title: [...nextParents, spec.title].filter(Boolean).join(' > '), error })
      }
    }
    for (const child of suite.suites || []) visitSuite(child, nextParents)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  return failures
}

function device(value) {
  if (value.includes('desktop')) return 'd'
  if (value.includes('iphone')) return 'i'
  if (value.includes('android')) return 'a'
  return 'b'
}

function category(value) {
  const title = String(value || '').toLowerCase()
  if (title.includes('reports preview')) return 'preview'
  if (title.includes('reports pdf download')) return 'pdf'
  if (title.includes('reports excel download')) return 'excel'
  if (title.includes('scheduler sees')) return 'support-access'
  if (title.includes('scheduler opens')) return 'support-editor'
  if (title.includes('schedule') || title.includes('dienstplan')) return 'schedule'
  return 'other'
}

function compact(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'unknown'
}

function failureLine(error, testLines) {
  const lineNumber = Number(String(error || '').match(/unified-portal\.spec\.mjs:(\d+)/)?.[1] || 0)
  const source = lineNumber ? testLines[lineNumber - 1] : ''
  return { lineNumber, source }
}

function reason(error, source) {
  const text = String(error || '').replace(/\x1b\[[0-9;]*m/g, '')
  const navMissing = text.match(/Navigation fehlt:\s*([^\n]+)/i)
  if (navMissing) return compact(navMissing[1])
  const lower = text.toLowerCase()
  if (lower.includes('strict mode violation')) return 'duplicate-locator'
  if (lower.includes('waitforevent') || lower.includes('waiting for event')) return 'download-event'
  if (lower.includes('timed out')) return 'timeout'
  if (source) return compact(source)
  const first = text.split('\n').map((line) => line.trim()).find((line) => /^(error|typeerror|referenceerror|expect)/i.test(line))
  return compact(first || text.slice(0, 160))
}

async function createMarker(name, payload) {
  const safeName = name.replace(/[^a-z0-9-]/g, '-').slice(0, 115)
  const source = `import type { Config } from '@netlify/functions'\nexport default async () => Response.json(${JSON.stringify(payload)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\nexport const config: Config = { path: '/api/${safeName}' }\n`
  await writeFile(`${functionsDir}/${safeName}.mts`, source)
}

try {
  for (const name of await readdir(functionsDir)) {
    if ((name.startsWith('audit-browser-') || name.startsWith('audit-fail-')) && name.endsWith('.mts')) await rm(`${functionsDir}/${name}`)
  }

  let stage = 'install'
  let result = run('npx', ['playwright', 'install', 'chromium'])
  let details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  let failures = []

  for (const [nextStage, command, args] of [
    ['prepare', 'node', ['scripts/prepare-unified-e2e.mjs']],
    ['split', 'node', ['scripts/split-browser-audit-tests.mjs']],
    ['mocks', 'node', ['scripts/fix-e2e-runtime-mocks.mjs']],
  ]) {
    if (result.status !== 0) break
    stage = nextStage
    result = run(command, args)
    details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  }

  if (result.status === 0) {
    stage = 'tests'
    result = run('npx', ['playwright', 'test', testPath, '--grep', 'reports', '--reporter=json'])
    details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    try { failures = collectFailures(JSON.parse(result.stdout || '{}')) } catch { failures = [] }
  }

  const testLines = (await readFile(testPath, 'utf8')).split('\n')
  const success = result.status === 0
  const categories = [...new Set(failures.map((failure) => category(failure.title)))].slice(0, 6)
  await createMarker(success ? 'audit-browser-reports-success-9' : `audit-browser-reports-failed-${stage}-${failures.length || 'unknown'}-${categories.join('-') || 'unparsed'}`, {
    success, stage, exitCode: result.status, expectedTests: 9, failures, details: details.slice(-12000),
  })

  for (const failure of failures) {
    const at = failureLine(failure.error, testLines)
    const name = `audit-fail-${device(failure.project)}-${category(failure.title)}-l${at.lineNumber || 0}-${reason(failure.error, at.source)}`
    await createMarker(name, { project: failure.project, title: failure.title, line: at.lineNumber, source: at.source, error: failure.error.slice(0, 4000) })
  }
} catch (error) {
  await createMarker('audit-browser-runner-crash', { success: false, stage: 'runner', error: String(error?.stack || error) })
}
