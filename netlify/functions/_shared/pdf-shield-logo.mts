import {
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

const SOURCE_HEIGHT = 203
const SHIELD_LEFT = 237
const SHIELD_TOP = 39
const SHIELD_WIDTH = 129
const SHIELD_HEIGHT = 132

export function shieldLogoPlacement(logo: Pick<PDFImage, 'width' | 'height'>, pageWidth: number, topY: number, targetWidth = 76) {
  const scale = targetWidth / SHIELD_WIDTH
  const centerX = pageWidth / 2
  const shieldLeft = centerX - targetWidth / 2
  const shieldHeight = SHIELD_HEIGHT * scale
  const shieldBottom = topY - shieldHeight
  return {
    centerX,
    scale,
    shieldLeft,
    shieldBottom,
    shieldWidth: targetWidth,
    shieldHeight,
    imageX: shieldLeft - SHIELD_LEFT * scale,
    imageY: shieldBottom - (SOURCE_HEIGHT - SHIELD_TOP - SHIELD_HEIGHT) * scale,
    imageWidth: logo.width * scale,
    imageHeight: logo.height * scale,
  }
}

export function drawCenteredShieldLogo(page: PDFPage, logo: PDFImage | null, pageWidth: number, topY: number, targetWidth = 76) {
  if (!logo) return null
  const placement = shieldLogoPlacement(logo, pageWidth, topY, targetWidth)
  const x0 = placement.shieldLeft
  const x1 = placement.shieldLeft + placement.shieldWidth
  const y0 = placement.shieldBottom
  const y1 = placement.shieldBottom + placement.shieldHeight
  const center = placement.centerX

  page.pushOperators(
    pushGraphicsState(),
    moveTo(x0 + placement.shieldWidth * 0.08, y1),
    lineTo(x1 - placement.shieldWidth * 0.08, y1),
    lineTo(x1 - placement.shieldWidth * 0.12, y0 + placement.shieldHeight * 0.47),
    lineTo(center + placement.shieldWidth * 0.20, y0 + placement.shieldHeight * 0.20),
    lineTo(center, y0),
    lineTo(center - placement.shieldWidth * 0.20, y0 + placement.shieldHeight * 0.20),
    lineTo(x0 + placement.shieldWidth * 0.12, y0 + placement.shieldHeight * 0.47),
    closePath(),
    clip(),
    endPath(),
  )
  page.drawImage(logo, {
    x: placement.imageX,
    y: placement.imageY,
    width: placement.imageWidth,
    height: placement.imageHeight,
  })
  page.pushOperators(popGraphicsState())
  return placement
}

export function centeredTextX(font: { widthOfTextAtSize(text: string, size: number): number }, text: string, size: number, pageWidth: number) {
  return Math.max(24, (pageWidth - font.widthOfTextAtSize(text, size)) / 2)
}

export async function loadOriginalLogo(pdf: { embedPng(bytes: ArrayBuffer): Promise<PDFImage> }, request: Request) {
  try {
    const response = await fetch(new URL('/habun-logo.png', request.url), { cache: 'no-store' })
    if (!response.ok) return null
    return await pdf.embedPng(await response.arrayBuffer())
  } catch {
    return null
  }
}
