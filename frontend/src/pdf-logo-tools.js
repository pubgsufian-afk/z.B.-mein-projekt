const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_DIMENSION = 1600

function colorDistance(data, offset, background) {
  const dr = data[offset] - background[0]
  const dg = data[offset + 1] - background[1]
  const db = data[offset + 2] - background[2]
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db))
}

function averageCornerColor(data, width, height) {
  const points = [
    0,
    (width - 1) * 4,
    ((height - 1) * width) * 4,
    (((height - 1) * width) + width - 1) * 4,
  ]
  const opaque = points.filter((offset) => data[offset + 3] > 20)
  const samples = opaque.length ? opaque : points
  return [0, 1, 2].map((channel) => Math.round(samples.reduce((sum, offset) => sum + data[offset + channel], 0) / samples.length))
}

export function removeEdgeConnectedBackground(data, width, height, tolerance = 42) {
  if (!data || width <= 0 || height <= 0 || data.length < width * height * 4) return data
  const background = averageCornerColor(data, width, height)
  const visited = new Uint8Array(width * height)
  const queue = []

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y * width) + x
    if (visited[index]) return
    visited[index] = 1
    const offset = index * 4
    if (data[offset + 3] <= 8 || colorDistance(data, offset, background) <= tolerance) queue.push(index)
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    const x = index % width
    const y = Math.floor(index / width)
    const offset = index * 4
    data[offset + 3] = 0
    enqueue(x - 1, y)
    enqueue(x + 1, y)
    enqueue(x, y - 1)
    enqueue(x, y + 1)
  }
  return data
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Logo konnte nicht gelesen werden.')) }
    image.src = url
  })
}

export async function preparePdfLogo(file) {
  if (!file) throw new TypeError('Bitte zuerst ein Firmenlogo auswählen.')
  if (!ACCEPTED_TYPES.has(String(file.type || '').toLowerCase())) {
    throw new TypeError('Bitte PNG, JPG/JPEG oder WebP als Firmenlogo verwenden.')
  }
  if (Number(file.size || 0) > MAX_SOURCE_BYTES) {
    throw new TypeError('Das Firmenlogo ist zu groß. Bitte eine Datei unter 10 MB verwenden.')
  }

  const image = await loadImage(file)
  const sourceWidth = Number(image.width || image.naturalWidth || 0)
  const sourceHeight = Number(image.height || image.naturalHeight || 0)
  if (!sourceWidth || !sourceHeight) throw new TypeError('Das Firmenlogo hat ungültige Abmessungen.')

  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new TypeError('Das Firmenlogo konnte nicht verarbeitet werden.')

  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  if (typeof image.close === 'function') image.close()
  const imageData = context.getImageData(0, 0, width, height)
  removeEdgeConnectedBackground(imageData.data, width, height)

  let visiblePixels = 0
  for (let offset = 3; offset < imageData.data.length; offset += 4) {
    if (imageData.data[offset] > 20) visiblePixels += 1
  }
  if (visiblePixels < Math.max(12, Math.round(width * height * 0.002))) {
    throw new TypeError('Nach dem Entfernen des Hintergrunds ist kein brauchbares Logo übrig geblieben.')
  }

  context.putImageData(imageData, 0, 0)
  const png = canvas.toDataURL('image/png')
  if (!png.startsWith('data:image/png;base64,')) throw new TypeError('Das Firmenlogo konnte nicht als PNG gespeichert werden.')
  return png
}
