#!/usr/bin/env node
// The Matrix theme's digital rain: draws its tiles and writes them into themes/matrix.css as custom properties, in two
// blocks: /* rain:begin */ … /* rain:end */ (inside the theme's gate) and /* card:begin */ … /* card:end */ (the theme
// screen's card, outside it). Node, no dependencies; seeded, so the output never changes unless the numbers below do.
// Run: node scripts/make-matrix-rain.mjs
//
// How the rain works (as in the film, the glyphs stay put and the drops are light running down the columns):
// - the GRID is a fixed tile of glyphs cut out of a page-coloured sheet;
// - the LIGHTS are tiles of drops (a bright head with a fading trail above it) that slide down behind the grid one cell
//   at a time, so a glyph lights up as a head reaches it and dims as the trail passes. The dashboard has two (each with
//   its own tile size and speed, so drops of two speeds share every column), the boot screen a denser one.
// - the RAG is the ragged top edge of the intro's curtain: each column's code fades out at its own height.
// Glyphs: mirrored half-width katakana, the digits and a few symbols, in Hiragino Sans (a macOS system font).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'matrix.css')

const PAGE = '#000200' // the sheet the grid is cut from: the theme's page colour
const FAMILY = "'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif"
const HEAD = ['#e8ffe0', 0.62] // the drop's leading glyph: colour, opacity
// the trail, from the top (gone) down to the glyph just behind the head
const TRAIL = [[0, '#176105', 0], [0.4, '#176105', 0.3], [0.8, '#89f76e', 0.38], [1, '#c1ff75', 0.46]]
const FULL = { w: 14, h: 20, font: 15 } // a dashboard glyph cell (px) and its glyph size
const MINI = { w: 7, h: 10, font: 7.5 } // the theme card's picture is about half size
const RAIN = { len: [4, 18], gap: [10, 34] } // drop and gap lengths, in cells
const DENSE = { len: [6, 20], gap: [3, 12] }

// name: the custom property; seed; tile size in cells; step: seconds per cell
const GRIDS = [
  { name: 'grid', cell: FULL, seed: 37, cols: 47, rows: 31 },
]
const LIGHTS = [
  { name: 'light-a', cell: FULL, drop: RAIN, seed: 11, cols: 41, rows: 52, step: 0.08 }, // the near, fast drops
  { name: 'light-b', cell: FULL, drop: RAIN, seed: 23, cols: 37, rows: 46, step: 0.125 }, // the far, slow ones
  { name: 'boot', cell: FULL, drop: DENSE, seed: 41, cols: 43, rows: 48, step: 0.07 }, // the launch screen's
  // the idle screensaver's: it falls together with the grid, so its height must be a whole number of grid tiles
  { name: 'idle', cell: FULL, drop: DENSE, seed: 71, cols: 41, rows: 62, step: 0.08, withGrid: 'grid' },
]
const RAG = { name: 'rag', seed: 53, cols: 41, height: 480 } // matrix.css's intro uses the 480px
const CARD = {
  grid: { name: 'mini-grid', cell: MINI, seed: 61, cols: 29, rows: 17 },
  // brighter (gain): its glyphs are small, and they show only through the picture's panels and the gaps between them
  light: { name: 'mini-light', cell: MINI, drop: { len: [3, 12], gap: [6, 20] }, seed: 67, cols: 23, rows: 31, step: 0.09, gain: 1.5 },
}

const KANA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i))
const DIGITS = [...'0123456789']
const SYMBOLS = [...':."=*+-<>|_']
const WIDEN = 1.3 // half-width katakana are narrow; the film's glyphs are wider

// mulberry32: small, seeded, good enough for scattering glyphs
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)]
const between = (rnd, [lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1))
const num = (n) => String(Math.round(n * 100) / 100)

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// an SVG as a CSS url(): ASCII only, no newlines, nothing that ends the string or starts a fragment
function dataUrl(svg) {
  const body = [...svg].map((ch) => {
    if (ch === '%') return '%25'
    if (ch === '#') return '%23'
    if (ch === '"') return '%22'
    if (ch === '<') return '%3C'
    if (ch === '>') return '%3E'
    if (ch.charCodeAt(0) > 0x7e) return encodeURIComponent(ch)
    return ch
  }).join('')
  return `url("data:image/svg+xml,${body}")`
}
const svgOpen = (w, h) => `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`

// The drops of one column, around a loop of `rows` cells (the tile repeats, so a drop may wrap past the bottom).
function drops(rnd, rows, drop) {
  const out = []
  let at = Math.floor(rnd() * rows)
  let used = 0
  for (;;) {
    const len = between(rnd, drop.len)
    const gap = between(rnd, drop.gap)
    if (used + len + gap > rows) break
    out.push({ top: at, len }) // the head is the bottom cell: top + len - 1
    at = (at + len + gap) % rows
    used += len + gap
  }
  if (!out.length) out.push({ top: at, len: Math.min(between(rnd, drop.len), rows - drop.gap[0]) }) // no dark column
  return out
}

function lightTile({ cell, drop, seed, cols, rows, gain = 1 }) {
  const rnd = rng(seed)
  const w = cols * cell.w
  const h = rows * cell.h
  const trails = []
  const heads = []
  for (let c = 0; c < cols; c++) {
    const x = c * cell.w
    for (const d of drops(rnd, rows, drop)) {
      // draw it where it is and once a loop higher, so a drop that wraps past the bottom comes in at the top
      for (const shift of [0, -rows]) {
        const top = d.top + shift
        const head = top + d.len - 1
        if (head < 0) continue // nothing of it lands in the tile
        if (d.len > 1) trails.push(`<rect x='${x}' y='${top * cell.h}' width='${cell.w}' height='${(d.len - 1) * cell.h}'/>`)
        heads.push(`M${x} ${head * cell.h}h${cell.w}v${cell.h}h-${cell.w}z`)
      }
    }
  }
  const lit = (a) => num(Math.min(1, a * gain))
  const stops = TRAIL.map(([o, c, a]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${lit(a)}'/>`).join('')
  const svg = svgOpen(w, h) + `<linearGradient id='t' x2='0' y2='1'>${stops}</linearGradient>`
    + `<g fill='url(#t)'>${trails.join('')}</g><path fill='${HEAD[0]}' fill-opacity='${lit(HEAD[1])}' d='${heads.join('')}'/></svg>`
  return { svg, w, h }
}

function gridTile({ cell, seed, cols, rows }) {
  const rnd = rng(seed)
  const w = cols * cell.w
  const h = rows * cell.h
  const kanaRows = []
  const restRows = []
  for (let r = 0; r < rows; r++) {
    const y = num(r * cell.h + cell.h / 2)
    const kana = { xs: [], s: '' }
    const rest = { xs: [], s: '' }
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cell.w
      const roll = rnd()
      if (roll < 0.74) {
        // katakana, mirrored: drawn in a group flipped (and widened) about the tile, so place it at the mirror image
        kana.xs.push(num((w - cx) / WIDEN))
        kana.s += pick(rnd, KANA)
      } else {
        rest.xs.push(num(cx))
        rest.s += pick(rnd, roll < 0.93 ? DIGITS : SYMBOLS)
      }
    }
    if (kana.s) kanaRows.push(`<text x='${kana.xs.join(' ')}' y='${y}'>${xml(kana.s)}</text>`)
    if (rest.s) restRows.push(`<text x='${rest.xs.join(' ')}' y='${y}'>${xml(rest.s)}</text>`)
  }
  const svg = svgOpen(w, h) + `<mask id='m'><rect width='${w}' height='${h}' fill='#fff'/>`
    + `<g fill='#000' font-family="${FAMILY}" font-size='${cell.font}' font-weight='600' text-anchor='middle' dominant-baseline='central'>`
    + `<g transform='matrix(-${WIDEN} 0 0 1 ${w} 0)'>${kanaRows.join('')}</g>${restRows.join('')}</g></mask>`
    + `<rect width='${w}' height='${h}' fill='${PAGE}' mask='url(#m)'/></svg>`
  return { svg, w, h }
}

// The curtain's top edge, as a mask (opaque = code shows): each column fades in from its own height, solid below.
function ragTile({ seed, cols, height }) {
  const rnd = rng(seed)
  const w = cols * FULL.w
  const rects = []
  for (let c = 0; c < cols; c++) {
    const from = Math.floor(rnd() * (height - 280))
    const fade = 100 + Math.floor(rnd() * 180)
    rects.push(`<rect x='${c * FULL.w}' y='${from}' width='${FULL.w}' height='${fade}' fill='url(#f)'/>`)
    rects.push(`<rect x='${c * FULL.w}' y='${from + fade}' width='${FULL.w}' height='${Math.max(0, height - from - fade)}'/>`)
  }
  const svg = svgOpen(w, height) + `<linearGradient id='f' x2='0' y2='1'><stop offset='0' stop-opacity='0'/><stop offset='1'/></linearGradient>`
    + `<g fill='#000'>${rects.join('')}</g></svg>`
  return { svg, w, h: height }
}

const props = (name, { svg, w, h }) => [`--svb-mx-${name}: ${dataUrl(svg)};`, `--svb-mx-${name}-size: ${w}px ${h}px;`]
const lightProps = (l) => {
  const t = lightTile(l)
  return [...props(l.name, t), `--svb-mx-${l.name}-h: ${t.h}px;`, `--svb-mx-${l.name}-run: ${num(l.rows * l.step)}s steps(${l.rows});`]
}

function block(tag, selector, decls, indent) {
  const pad = ' '.repeat(indent)
  return [`/* ${tag}:begin */`, `${pad}/* generated by scripts/make-matrix-rain.mjs: do not edit by hand */`, `${pad}${selector} {`,
    ...decls.map((d) => `${pad}  ${d}`), `${pad}}`, `${pad}/* ${tag}:end */`].join('\n')
}

for (const l of LIGHTS.filter((x) => x.withGrid)) {
  const g = GRIDS.find((x) => x.name === l.withGrid)
  if ((l.rows * l.cell.h) % (g.rows * g.cell.h)) throw new Error(`make-matrix-rain: ${l.name} must be a whole number of ${g.name} tiles tall`)
}
const cell = [`--svb-mx-cell-w: ${FULL.w}px;`, `--svb-mx-cell-h: ${FULL.h}px;`]
const rain = [...cell, ...GRIDS.flatMap((g) => props(g.name, gridTile(g))), ...LIGHTS.flatMap(lightProps), ...props(RAG.name, ragTile(RAG))]
const card = [...props(CARD.grid.name, gridTile(CARD.grid)), ...lightProps(CARD.light)]

let css = readFileSync(CSS, 'utf8')
for (const [tag, selector, decls, indent] of [['rain', 'body', rain, 2], ['card', '.th-card[data-id="svoboden-matrix"]', card, 0]]) {
  const re = new RegExp(`/\\* ${tag}:begin \\*/[\\s\\S]*?/\\* ${tag}:end \\*/`)
  if (!re.test(css)) {
    console.error(`make-matrix-rain: no /* ${tag}:begin */ ... /* ${tag}:end */ block in ${CSS}`)
    process.exit(1)
  }
  css = css.replace(re, () => block(tag, selector, decls, indent))
}
writeFileSync(CSS, css)
console.log(`make-matrix-rain: wrote the rain into ${CSS} (${Buffer.byteLength(css)} bytes)`)
