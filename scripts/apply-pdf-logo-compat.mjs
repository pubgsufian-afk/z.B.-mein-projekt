import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-reports.mts'
const source = await readFile(path, 'utf8')
const oldBlock = `    const drawWatermark = () => {
      drawCenteredPdfWatermark(page, logo, width, height, 210, 155, 0.06)
    }`
const newBlock = `    const watermarkStyle = { opacity: 0.06 }
    const drawWatermark = () => {
      drawCenteredPdfWatermark(page, logo, width, height, 210, 155, watermarkStyle.opacity)
    }`

if (source.includes(newBlock)) {
  console.log('Timesheet watermark compatibility already applied')
} else if (source.includes(oldBlock)) {
  await writeFile(path, source.replace(oldBlock, newBlock))
  console.log('Timesheet watermark compatibility applied')
} else {
  throw new Error('Timesheet watermark block not found')
}
