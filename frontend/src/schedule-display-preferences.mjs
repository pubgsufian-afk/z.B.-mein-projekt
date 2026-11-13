const KEY = 'habunScheduleScaleV1'
const SCALES = [0.85, 1, 1.25, 1.5]

export function getScheduleDisplayScale() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    if (SCALES.includes(saved)) return saved
  } catch {}
  return 1
}

export function saveScheduleDisplayScale(value) {
  if (!SCALES.includes(value)) return
  try { localStorage.setItem(KEY, String(value)) } catch {}
}
