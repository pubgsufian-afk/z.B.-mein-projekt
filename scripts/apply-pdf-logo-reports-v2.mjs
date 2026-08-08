import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/reports-v2.mts'
let source = await readFile(path, 'utf8')
let changed = false

const importAnchor = "import { databaseConnectionString } from './_shared/database-connection.mts'\n"
const brandingImport = "import { drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'\n"
if (!source.includes(brandingImport)) {
  if (!source.includes(importAnchor)) throw new Error('reports-v2 import anchor not found')
  source = source.replace(importAnchor, `${importAnchor}${brandingImport}`)
  changed = true
}

const oldLogoLoader = `  let logo: any = null
  try {
    const response = await fetch(new URL('/habun-logo.png', request.url))
    if (response.ok) logo = await pdf.embedPng(await response.arrayBuffer())
  } catch {}`
const newLogoLoader = `  const logo = await loadOriginalLogo(pdf, request)`
if (source.includes(oldLogoLoader)) {
  source = source.replace(oldLogoLoader, newLogoLoader)
  changed = true
} else if (!source.includes(newLogoLoader)) {
  throw new Error('reports-v2 logo loader not found')
}

const oldHeaderLogo = `    if (logo) {
      const scaled = logo.scale(0.11)
      page.drawImage(logo, { x: margin, y: y - scaled.height + 8, width: scaled.width, height: scaled.height })
    }`
const newWatermark = `    drawCenteredPdfWatermark(page, logo, width, height, 220, 175, 0.06)`
if (source.includes(oldHeaderLogo)) {
  source = source.replace(oldHeaderLogo, newWatermark)
  changed = true
} else if (!source.includes(newWatermark)) {
  throw new Error('reports-v2 header logo block not found')
}

if (changed) {
  await writeFile(path, source)
  console.log('Reports V2 central PDF watermark applied')
} else {
  console.log('Reports V2 central PDF watermark already applied')
}
