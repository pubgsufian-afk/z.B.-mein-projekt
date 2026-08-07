import type { PDFImage, PDFPage } from 'pdf-lib'
import { EXPORT_LOGO_PNG_BASE64 } from './export-logo.mts'

export function shieldLogoPlacement(logo: Pick<PDFImage, 'width' | 'height'>, pageWidth: number, topY: number, targetWidth = 76) {
  const scale = targetWidth / logo.width
  const imageWidth = logo.width * scale
  const imageHeight = logo.height * scale
  const imageX = (pageWidth - imageWidth) / 2
  const imageY = topY - imageHeight
  return {
    centerX: pageWidth / 2,
    scale,
    shieldLeft: imageX,
    shieldBottom: imageY,
    shieldWidth: imageWidth,
    shieldHeight: imageHeight,
    imageX,
    imageY,
    imageWidth,
    imageHeight,
  }
}

export function drawCenteredShieldLogo(page: PDFPage, logo: PDFImage | null, pageWidth: number, topY: number, targetWidth = 76) {
  if (!logo) return null
  const placement = shieldLogoPlacement(logo, pageWidth, topY, targetWidth)
  page.drawImage(logo, {
    x: placement.imageX,
    y: placement.imageY,
    width: placement.imageWidth,
    height: placement.imageHeight,
  })
  return placement
}

export function centeredTextX(font: { widthOfTextAtSize(text: string, size: number): number }, text: string, size: number, pageWidth: number) {
  return Math.max(24, (pageWidth - font.widthOfTextAtSize(text, size)) / 2)
}

export async function loadOriginalLogo(pdf: { embedPng(bytes: Uint8Array): Promise<PDFImage> }, _request: Request) {
  try {
    const bytes = Buffer.from(EXPORT_LOGO_PNG_BASE64, 'base64')
    return await pdf.embedPng(bytes)
  } catch {
    return null
  }
}
