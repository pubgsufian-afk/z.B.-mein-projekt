import { readFile, writeFile } from 'node:fs/promises'

async function patchTimesheet() {
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
}

async function patchFixedSchedule() {
  const path = 'netlify/functions/schedule-pdf-fixed.mts'
  const source = await readFile(path, 'utf8')
  const oldCall = '    drawCenteredShieldLogo(page, logo, width, height - 22, 94)'
  const newCall = '    drawCenteredPdfWatermark(page, logo, width, height, 210, 170, 0.06)'
  if (source.includes(newCall)) {
    console.log('Fixed schedule watermark compatibility already applied')
  } else if (source.includes(oldCall)) {
    await writeFile(path, source.replace(oldCall, newCall))
    console.log('Fixed schedule watermark compatibility applied')
  } else {
    throw new Error('Fixed schedule logo call not found')
  }
}

await patchTimesheet()
await patchFixedSchedule()
