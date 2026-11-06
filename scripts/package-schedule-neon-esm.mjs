import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'

// Build the TypeScript function into a proper ESM entry point before Netlify
// packages it. The previous runtime tried to require() an .mts module as CJS.
const source = 'netlify/functions/schedule-v2-neon.mts'
const output = 'netlify/functions/schedule-v2-neon.mjs'

await build({
  entryPoints: [source],
  outfile: output,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: true,
  packages: 'external',
  logLevel: 'info',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})

const compiled = await readFile(output, 'utf8')
assert.match(compiled, /path:\\s*["']\\/api\\/schedule-v2["']/, 'Compiled schedule function must retain its API route')
assert.doesNotMatch(compiled, /from\\s+["'][^"']+\\.mts["']/, 'Compiled function must not import a runtime .mts file')

// Only remove the source from Netlify deployment builds, not local/CI E2E
// source-contract runs. This guarantees the ESM entry is the sole deployed
// schedule-v2-neon function, avoiding an .mts CommonJS require wrapper.
if (process.env.NETLIFY === 'true' || ['production', 'deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT || '')) {
  await rm(source)
}
console.log('Prepared Netlify ESM schedule-v2-neon function')
