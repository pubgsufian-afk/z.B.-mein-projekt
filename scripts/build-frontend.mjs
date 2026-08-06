import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('public/assets', { recursive: true })
await build({
  entryPoints: ['frontend/src/main.jsx'],
  outdir: 'public/assets',
  entryNames: 'habun-portal',
  assetNames: 'habun-[name]-[hash]',
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  logLevel: 'info',
})
