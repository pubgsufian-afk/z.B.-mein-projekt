import { readdir, rm, writeFile } from 'node:fs/promises'
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

function sanitize(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function createMarker(name, payload) {
  const safeName = name.replace(/[^a-z0-9-]/g, '-').slice(0, 115)
  const source = `import type { Config } from '@netlify/functions'\nexport default async () => Response.json(${JSON.stringify(payload)}, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })\nexport const config: Config = { path: '/api/${safeName}' }\n`
  await writeFile(`${functionsDir}/${safeName}.mts`, source)
}

try {
  for (const name of await readdir(functionsDir)) {
    if ((name.startsWith('audit-browser-') || name.startsWith('audit-fail-') || name.startsWith('audit-error-')) && name.endsWith('.mts')) await rm(`${functionsDir}/${name}`)
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
    result = run('npx', ['playwright', 'test', testPath, '--project=desktop-chromium', '--grep', 'reports preview', '--reporter=json'])
    details = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    try { failures = collectFailures(JSON.parse(result.stdout || '{}')) } catch { failures = [] }
  }

  const success = result.status === 0
  await createMarker(success ? 'audit-browser-single-success' : `audit-browser-single-failed-${stage}`, {
    success, stage, exitCode: result.status, failures, details: details.slice(-16000),
  })

  const errorText = sanitize(failures[0]?.error || details || 'keine-fehlermeldung')
  const chunks = errorText.match(/.{1,78}/g)?.slice(0, 8) || ['keine-fehlermeldung']
  for (let index = 0; index < chunks.length; index += 1) {
    await createMarker(`audit-error-${String(index + 1).padStart(2, '0')}-${chunks[index]}`, { index: index + 1, chunk: chunks[index] })
  }
} catch (error) {
  await createMarker('audit-browser-runner-crash', { success: false, stage: 'runner', error: String(error?.stack || error) })
}
