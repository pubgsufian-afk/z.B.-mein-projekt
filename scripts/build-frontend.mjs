import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await import('./run-instant-portal-data-performance-once.mjs')
await import('./display-snapshots-test.mjs')
await import('./admin-overview-performance-test.mjs')
await import('./instant-page-snapshots-test.mjs')

await mkdir('public/assets', { recursive: true })
await build({
  entryPoints: ['frontend/src/main.jsx'],
  inject: ['frontend/src/employee-role-management-auto.js'],
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
