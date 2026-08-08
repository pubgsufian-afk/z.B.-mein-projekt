import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/styles.css'
const source = await readFile(path, 'utf8')
const marker = '/* pdf-logo-settings */'
if (!source.includes(marker)) {
  const css = `

${marker}
.pdf-logo-settings{display:flex;flex-direction:column;gap:16px}.pdf-logo-preview{min-height:220px;border:1px solid var(--border,#d8d8d8);border-radius:16px;background:linear-gradient(135deg,#fafafa,#f1f1f1);display:flex;align-items:center;justify-content:center;padding:28px;overflow:hidden}.pdf-logo-preview img{display:block;max-width:min(100%,320px);max-height:180px;object-fit:contain;background:transparent}.pdf-logo-file{display:flex;flex-direction:column;gap:8px;font-weight:700}.pdf-logo-file input[type=file]{width:100%;padding:12px;border:1px solid var(--border,#d8d8d8);border-radius:12px;background:#fff}.pdf-logo-file small{font-weight:400;line-height:1.45;color:var(--muted,#666)}.pdf-logo-actions{display:flex;flex-wrap:wrap;gap:10px}.pdf-logo-actions .primary-button,.pdf-logo-actions .secondary-button{flex:1 1 180px}@media(max-width:720px){.pdf-logo-preview{min-height:180px;padding:20px}.pdf-logo-preview img{max-height:145px}.pdf-logo-actions{flex-direction:column}.pdf-logo-actions .primary-button,.pdf-logo-actions .secondary-button{width:100%;flex-basis:auto}}
`
  await writeFile(path, `${source.trimEnd()}${css}\n`)
  console.log('PDF logo settings styles applied')
} else {
  console.log('PDF logo settings styles already present')
}
