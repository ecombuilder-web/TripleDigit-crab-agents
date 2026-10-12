// Pixel crab avatars, each with its own hat, plus the progress bar, as SVG markup.

const BODY = '#D97757'
const EYE = '#1c1917'

type Px = [x: number, y: number, w: number, h: number, color: string]

/** Twenty hats; the pane hands them out so no two crabs on screen share one. */
export const HATS: { name: string; px: Px[] }[] = [
  { name: 'top hat', px: [[7, 1, 8, 6, '#1f1f24'], [7, 5, 8, 1, '#c0392b'], [4, 7, 14, 1, '#1f1f24']] },
  { name: 'cowboy hat', px: [[7, 3, 8, 4, '#8b5a2b'], [10, 3, 2, 1, '#6b4420'], [7, 5, 8, 1, '#3e2a14'], [2, 7, 18, 1, '#8b5a2b'], [2, 6, 1, 1, '#8b5a2b'], [19, 6, 1, 1, '#8b5a2b']] },
  { name: 'beanie', px: [[6, 4, 10, 4, '#3b82f6'], [6, 6, 10, 1, '#1d4ed8'], [10, 2, 2, 2, '#e2e8f0']] },
  { name: 'baseball cap', px: [[6, 4, 9, 4, '#dc2626'], [15, 6, 5, 2, '#b91c1c'], [10, 3, 1, 1, '#b91c1c']] },
  { name: 'party hat', px: [[10, 0, 2, 1, '#fde047'], [10, 1, 2, 2, '#ec4899'], [9, 3, 4, 2, '#ec4899'], [8, 5, 6, 2, '#ec4899'], [7, 7, 8, 1, '#ec4899'], [10, 4, 1, 1, '#fde047'], [12, 6, 1, 1, '#22d3ee']] },
  { name: 'crown', px: [[6, 5, 10, 3, '#facc15'], [6, 3, 2, 2, '#facc15'], [10, 2, 2, 3, '#facc15'], [14, 3, 2, 2, '#facc15'], [10, 6, 2, 1, '#ef4444'], [7, 6, 1, 1, '#3b82f6'], [14, 6, 1, 1, '#22c55e']] },
  { name: 'chef hat', px: [[6, 0, 10, 2, '#f8fafc'], [5, 1, 12, 2, '#f8fafc'], [7, 3, 8, 4, '#f1f5f9'], [7, 3, 1, 4, '#cbd5e1'], [7, 7, 8, 1, '#94a3b8']] },
  { name: 'wizard hat', px: [[10, 0, 2, 2, '#7c3aed'], [9, 2, 4, 2, '#7c3aed'], [8, 4, 6, 2, '#7c3aed'], [7, 6, 8, 1, '#7c3aed'], [4, 7, 14, 1, '#5b21b6'], [10, 3, 1, 1, '#fde047'], [12, 5, 1, 1, '#fde047']] },
  { name: 'propeller cap', px: [[6, 5, 3, 3, '#ef4444'], [9, 5, 2, 3, '#facc15'], [11, 5, 2, 3, '#3b82f6'], [13, 5, 3, 3, '#22c55e'], [10, 3, 2, 2, '#64748b'], [6, 2, 10, 1, '#94a3b8']] },
  { name: 'hard hat', px: [[7, 4, 8, 3, '#facc15'], [6, 5, 10, 2, '#facc15'], [10, 3, 2, 3, '#eab308'], [4, 7, 14, 1, '#eab308']] },
  { name: 'graduation cap', px: [[3, 3, 16, 2, '#111827'], [7, 5, 8, 3, '#1f2937'], [18, 4, 1, 4, '#fbbf24'], [10, 3, 2, 1, '#fbbf24']] },
  { name: 'viking helmet', px: [[7, 4, 8, 4, '#9ca3af'], [6, 7, 10, 1, '#6b7280'], [4, 5, 2, 2, '#f5f0dc'], [3, 3, 2, 2, '#f5f0dc'], [3, 1, 1, 2, '#f5f0dc'], [16, 5, 2, 2, '#f5f0dc'], [17, 3, 2, 2, '#f5f0dc'], [18, 1, 1, 2, '#f5f0dc']] },
  { name: 'santa hat', px: [[6, 5, 9, 2, '#dc2626'], [8, 3, 6, 2, '#dc2626'], [12, 2, 4, 2, '#dc2626'], [16, 3, 2, 2, '#f8fafc'], [5, 7, 12, 1, '#f8fafc']] },
  { name: 'beret', px: [[5, 6, 12, 2, '#7f1d1d'], [6, 5, 10, 1, '#7f1d1d'], [10, 4, 1, 1, '#7f1d1d']] },
  { name: 'sombrero', px: [[0, 7, 22, 1, '#16a34a'], [0, 6, 1, 1, '#16a34a'], [21, 6, 1, 1, '#16a34a'], [7, 2, 8, 5, '#16a34a'], [7, 5, 8, 1, '#f97316'], [8, 1, 6, 1, '#16a34a']] },
  { name: 'headphones', px: [[5, 2, 12, 1, '#475569'], [4, 3, 1, 4, '#475569'], [17, 3, 1, 4, '#475569'], [2, 6, 3, 4, '#334155'], [17, 6, 3, 4, '#334155']] },
  { name: 'fez', px: [[7, 3, 8, 5, '#b91c1c'], [11, 2, 4, 1, '#111827'], [15, 2, 1, 4, '#111827']] },
  { name: 'flower crown', px: [[5, 7, 12, 1, '#15803d'], [5, 6, 2, 2, '#f472b6'], [9, 5, 2, 2, '#fde047'], [13, 5, 2, 2, '#a78bfa'], [16, 6, 2, 2, '#fb923c']] },
  { name: 'bucket hat', px: [[7, 3, 8, 3, '#0ea5e9'], [5, 6, 12, 2, '#0284c7']] },
  { name: 'pirate hat', px: [[5, 4, 12, 3, '#111827'], [3, 6, 16, 2, '#111827'], [10, 4, 2, 2, '#f8fafc']] },
]

const rect = ([x, y, w, h, c]: Px) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`

const CRAB: Px[] = [
  [4, 8, 14, 6, BODY], // body
  [1, 10, 3, 2, BODY], // left claw
  [18, 10, 3, 2, BODY], // right claw
  [7, 10, 1, 2, EYE],
  [14, 10, 1, 2, EYE],
  [5, 14, 1, 2, BODY],
  [8, 14, 1, 2, BODY],
  [13, 14, 1, 2, BODY],
  [16, 14, 1, 2, BODY],
]

const BLINK = '<animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite"/>'

/** A 22x16 pixel crab under hat `hat`; still, unless it needs you, then it blinks. */
export const crabSvg = (hat: number, isAlert: boolean, size = 44) => {
  const art = [...CRAB, ...(HATS[hat % HATS.length]?.px ?? [])].map(rect).join('')
  const h = Math.round((size * 16) / 22)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="${size}" height="${h}" shape-rendering="crispEdges"><g>${art}${isAlert ? BLINK : ''}</g></svg>`
}

/**
 * A rounded bar `width` px wide, filled to `fraction`; `isAlert` blinks it.
 * Never animated otherwise.
 */
export const barSvg = (width: number, color: string, fraction: number, isAlert = false, fillOpacity = 1) => {
  const w = Math.max(40, Math.round(width))
  const f = Math.max(0, Math.min(1, fraction))
  const fill = Math.max(f > 0 ? 6 : 0, Math.round(w * f))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6"><g><rect x="0" y="0" width="${w}" height="6" rx="3" fill="${color}" opacity="0.22"/><rect x="0" y="0" width="${fill}" height="6" rx="3" fill="${color}" opacity="${fillOpacity}"/>${isAlert ? BLINK : ''}</g></svg>`
}

/** A 1px line, wide enough for any pane; the slot clips it to the pane's width. */
export const ruleSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1" viewBox="0 0 2000 1" preserveAspectRatio="none"><rect width="2000" height="1" fill="${color}"/></svg>`
