import {
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'

const SOURCE_HEIGHT = 203
const LOGO_CROP_LEFT = 236
const LOGO_CROP_TOP = 44
const LOGO_CROP_WIDTH = 125
const LOGO_CROP_HEIGHT = 129

export function shieldLogoPlacement(logo: Pick<PDFImage, 'width' | 'height'>, pageWidth: number, topY: number, targetWidth = 76) {
  const scale = targetWidth / LOGO_CROP_WIDTH
  const centerX = pageWidth / 2
  const shieldLeft = centerX - targetWidth / 2
  const shieldHeight = LOGO_CROP_HEIGHT * scale
  const shieldBottom = topY - shieldHeight
  return {
    centerX,
    scale,
    shieldLeft,
    shieldBottom,
    shieldWidth: targetWidth,
    shieldHeight,
    imageX: shieldLeft - LOGO_CROP_LEFT * scale,
    imageY: shieldBottom - (SOURCE_HEIGHT - LOGO_CROP_TOP - LOGO_CROP_HEIGHT) * scale,
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

  page.drawRectangle({
    x: x0 - 3,
    y: y0 - 3,
    width: placement.shieldWidth + 6,
    height: placement.shieldHeight + 6,
    color: rgb(20 / 255, 20 / 255, 20 / 255),
    borderColor: rgb(.48, .48, .48),
    borderWidth: .6,
  })

  page.pushOperators(
    pushGraphicsState(),
    moveTo(x0, y1),
    lineTo(x1, y1),
    lineTo(x1, y0),
    lineTo(x0, y0),
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
