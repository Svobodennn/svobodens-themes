#!/usr/bin/env node
// The Matrix theme's digital rain: draws its tiles and writes them into themes/matrix.css, between
// /* rain:begin */ and /* rain:end */. Node, no dependencies; a seeded generator, so the output never changes
// unless the numbers below do. Run: node scripts/make-matrix-rain.mjs
//
// How the rain works (as in the film, the glyphs stay put and the drops are light running down the columns):
// - the GRID is a fixed tile of glyphs cut out of a page-coloured sheet (#top::before, static);
// - the LIGHTS are tiles of drops (a bright head with a fading trail above it) that slide down behind the grid one cell
//   at a time, so a glyph lights up as a head reaches it and dims as the trail passes. Two of them (#app::before and
//   #app::after), each with its own tile size and speed, so drops of two speeds share every column and overtake.
// Glyphs: mirrored half-width katakana, the digits and a few symbols, in Hiragino Sans (a macOS system font).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'matrix.css')

const CELL = { w: 14, h: 20 } // one glyph cell, px; the lights step down by one cell
const PAGE = '#000200' // the sheet the grid is cut from: the theme's page colour
const FONT = { family: "'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif", size: 15, weight: 600, kanaWiden: 1.3 }
const HEAD = ['#e8ffe0', 0.62] // the drop's leading glyph: colour, opacity
// the trail, from the top (gone) down to the glyph just behind the head
const TRAIL = [[0, '#176105', 0], [0.4, '#176105', 0.3], [0.8, '#89f76e', 0.38], [1, '#c1ff75', 0.46]]
const LAYERS = [
  { sel: '#app::before', seed: 11, cols: 41, rows: 52, step: 0.08 }, // the near, fast drops
  { sel: '#app::after', seed: 23, cols: 37, rows: 46, step: 0.125 }, // the far, slow ones (dimmed in matrix.css)
]
const GRID = { sel: '#top::before', seed: 37, cols: 47, rows: 31 }
const DROP = { len: [4, 18], gap: [10, 34] } // in cells, per light layer

const KANA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i))
const DIGITS = [...'0123456789']
const SYMBOLS = [...':."=*+-<>|_']

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

// The drops of one column, around a loop of `rows` cells (the tile repeats, so a drop may wrap past the bottom).
function drops(rnd, rows) {
  const out = []
  let at = Math.floor(rnd() * rows)
  let used = 0
  for (;;) {
    const len = between(rnd, DROP.len)
    const gap = between(rnd, DROP.gap)
    if (used + len + gap > rows) break
    out.push({ top: at, len }) // the head is the bottom cell: top + len - 1
    at = (at + len + gap) % rows
    used += len + gap
  }
  if (!out.length) out.push({ top: at, len: Math.min(between(rnd, DROP.len), rows - DROP.gap[0]) }) // no dark column
  return out
}

function lightTile({ seed, cols, rows }) {
  const rnd = rng(seed)
  const w = cols * CELL.w
  const h = rows * CELL.h
  const trails = []
  const heads = []
  for (let c = 0; c < cols; c++) {
    const x = c * CELL.w
    for (const d of drops(rnd, rows)) {
      // draw it where it is and once a loop higher, so a drop that wraps past the bottom comes in at the top
      for (const shift of [0, -rows]) {
        const top = d.top + shift
        const head = top + d.len - 1
        if (head < 0) continue // nothing of it lands in the tile
        if (d.len > 1) trails.push(`<rect x='${x}' y='${top * CELL.h}' width='${CELL.w}' height='${(d.len - 1) * CELL.h}'/>`)
        heads.push(`M${x} ${head * CELL.h}h${CELL.w}v${CELL.h}h-${CELL.w}z`)
      }
    }
  }
  const stops = TRAIL.map(([o, c, a]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`
    + `<linearGradient id='t' x2='0' y2='1'>${stops}</linearGradient>`
    + `<g fill='url(#t)'>${trails.join('')}</g><path fill='${HEAD[0]}' fill-opacity='${HEAD[1]}' d='${heads.join('')}'/></svg>`
  return { svg, w, h }
}

function gridTile({ seed, cols, rows }) {
  const rnd = rng(seed)
  const w = cols * CELL.w
  const h = rows * CELL.h
  const kanaRows = []
  const restRows = []
  for (let r = 0; r < rows; r++) {
    const y = num(r * CELL.h + CELL.h / 2)
    const kana = { xs: [], s: '' }
    const rest = { xs: [], s: '' }
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * CELL.w
      const roll = rnd()
      if (roll < 0.74) {
        // katakana, mirrored: drawn in a group flipped (and widened) about the tile, so place it at the mirror image
        kana.xs.push(num((w - cx) / FONT.kanaWiden))
        kana.s += pick(rnd, KANA)
      } else {
        rest.xs.push(num(cx))
        rest.s += pick(rnd, roll < 0.93 ? DIGITS : SYMBOLS)
      }
    }
    if (kana.s) kanaRows.push(`<text x='${kana.xs.join(' ')}' y='${y}'>${xml(kana.s)}</text>`)
    if (rest.s) restRows.push(`<text x='${rest.xs.join(' ')}' y='${y}'>${xml(rest.s)}</text>`)
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`
    + `<mask id='m'><rect width='${w}' height='${h}' fill='#fff'/>`
    + `<g fill='#000' font-family="${FONT.family}" font-size='${FONT.size}' font-weight='${FONT.weight}' text-anchor='middle' dominant-baseline='central'>`
    + `<g transform='matrix(-${FONT.kanaWiden} 0 0 1 ${w} 0)'>${kanaRows.join('')}</g>${restRows.join('')}</g></mask>`
    + `<rect width='${w}' height='${h}' fill='${PAGE}' mask='url(#m)'/></svg>`
  return { svg, w, h }
}

function block() {
  const lines = ['/* rain:begin */', '  /* generated by scripts/make-matrix-rain.mjs: do not edit by hand */']
  const anims = []
  for (const [i, layer] of LAYERS.entries()) {
    const { svg, w, h } = lightTile(layer)
    lines.push(`  ${layer.sel} { bottom: -${h}px; transform: translateY(-${h}px); background: ${dataUrl(svg)} 0 0 / ${w}px ${h}px; }`)
    anims.push(`    ${layer.sel} { animation: svb-mx-fall-${i} ${num(layer.rows * layer.step)}s steps(${layer.rows}) infinite; }`)
    anims.push(`    @keyframes svb-mx-fall-${i} { to { transform: translateY(0); } }`)
  }
  const grid = gridTile(GRID)
  lines.push(`  ${GRID.sel} { background: ${dataUrl(grid.svg)} 0 0 / ${grid.w}px ${grid.h}px; }`)
  lines.push('  @media (prefers-reduced-motion: no-preference) {', ...anims, '  }')
  lines.push('  /* rain:end */')
  return lines.join('\n')
}

const css = readFileSync(CSS, 'utf8')
const re = /\/\* rain:begin \*\/[\s\S]*?\/\* rain:end \*\//
if (!re.test(css)) {
  console.error(`make-matrix-rain: no /* rain:begin */ ... /* rain:end */ block in ${CSS}`)
  process.exit(1)
}
const out = css.replace(re, () => block())
writeFileSync(CSS, out)
console.log(`make-matrix-rain: wrote the rain into ${CSS} (${Buffer.byteLength(out)} bytes)`)
