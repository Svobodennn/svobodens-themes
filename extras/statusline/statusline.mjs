#!/usr/bin/env node
// Claude Code status line in the colours of Svoboden's Themes. Node, no dependencies.
//   cyberpunk-2077    a RAM bar: the context window in use
//   matrix            the same reading as a bar of falling half-width katakana
//   modern-warfare-2  a KILLSTREAK: tool calls in a row without an error, with MW2's rewards at 3, 5, 7 and 25
//
// In ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node /path/to/extras/statusline/statusline.mjs --theme matrix" }
//
// Claude Code sends the session as JSON on stdin (https://code.claude.com/docs/en/statusline) and shows the one line
// this prints. Context use comes from the last assistant message's usage in the transcript (input + cache tokens, as
// Claude Code counts used_percentage), read from the file's tail only: it runs after every message and transcripts
// grow to tens of megabytes.
//
// Every character printed is ASCII, box drawing (U+2500-257F) or half-width katakana (U+FF66-FF9D): one column
// everywhere, GNU screen 4.00.03 included, where an emoji or a variation selector shifts the rest of the row.
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// palettes:begin (written by extras/make-extras.mjs from themes/<slug>.json; edit those, then run it)
export const PALETTES = {
  "cyberpunk-2077": {
    "name": "Cyberpunk 2077",
    "bg": "#0e0e17",
    "fg": "#c6f6f8",
    "cursor": "#fcee0a",
    "selection": "#24484c",
    "accent": "#fcee0a",
    "ansi": ["#121221", "#fe1038", "#1ded83", "#fcee0a", "#4f88d5", "#a24df6", "#00f0ff", "#c0c8cf", "#55557a", "#ff6159", "#dfff5e", "#ffd741", "#64a1ff", "#c084ff", "#5ef6ff", "#ffffff"]
  },
  "matrix": {
    "name": "Matrix",
    "bg": "#010802",
    "fg": "#89f76e",
    "cursor": "#c1ff75",
    "selection": "#1d5c12",
    "accent": "#c1ff75",
    "ansi": ["#0a1a0c", "#d23c32", "#00cc00", "#cccc00", "#4a8fe0", "#9a7ce0", "#3fd9c8", "#bbffbb", "#2f6b35", "#ff5a4e", "#88ff88", "#eeee55", "#7fb2ff", "#b9a4ff", "#7ff2e3", "#ddffdd"]
  },
  "modern-warfare-2": {
    "name": "Modern Warfare 2",
    "bg": "#14130f",
    "fg": "#dfdddc",
    "cursor": "#dcad00",
    "selection": "#3f3d39",
    "accent": "#98d538",
    "ansi": ["#252520", "#d9534f", "#7bad35", "#dcad00", "#5b86b0", "#9d7fb0", "#2d9485", "#b6ae85", "#5c5a52", "#ff6b5e", "#bafeba", "#f0c94a", "#8fb3d9", "#c4a6d8", "#5fc4b4", "#f2f0ec"]
  }
}
// palettes:end

export const MILESTONES = [
  { at: 3, name: 'UAV' },
  { at: 5, name: 'PRECISION STRIKE' },
  { at: 7, name: 'GUNSHIP' },
  { at: 25, name: 'TACTICAL NUKE' },
]
const LAST_MILESTONE = MILESTONES[MILESTONES.length - 1].at

// Bytes read from the transcript's end, widened until the answer is in them. 25 tool results took about 1 MB in real
// transcripts (tool output is stored twice per result), the last assistant message about 12 KB.
export const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024]

// When Claude Code sends no context_window_size (versions before it existed): the 1M variants say so in their id, and
// the Claude 3 and 4 families default to 200K. Anything else is unknown rather than guessed.
const WINDOWS = [
  [/\[1m\]$/i, 1_000_000],
  [/^claude-(?:3|instant|(?:opus|sonnet|haiku)-4)/, 200_000],
]

const KANA = Array.from({ length: 0xff9d - 0xff66 + 1 }, (_, i) => String.fromCharCode(0xff66 + i))

/** Reads at most `bytes` from the end of `path`; null when it can't be read. `whole` is true when that is all of it. */
export function readTail(path, bytes) {
  let fd
  try {
    fd = openSync(path, 'r')
    const { size } = fstatSync(fd)
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    let got = 0
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got)
      if (n === 0) break
      got += n
    }
    return { text: buf.toString('utf8', 0, got), whole: start === 0 }
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** The transcript lines in `text` as objects. A tail starts mid-line, so its first line is dropped unless it is the
 *  whole file; a line that doesn't parse (the one being written) is skipped. */
export function parseTail(text, whole = true) {
  const lines = String(text).split('\n')
  if (!whole) lines.shift()
  const entries = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) entries.push(entry)
    } catch {
      // a line still being written, or not JSON at all
    }
  }
  return entries
}

const count = (v) => (Number.isFinite(v) && v > 0 ? v : 0)

/** Tokens a usage block puts in the context window: input and cache, not output (as Claude Code's used_percentage). */
export function inputTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  return count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens)
}

/** Context in use after the last main-thread API response in `entries`; null when there is none. A compaction after it
 *  replaces it with the compacted size. Responses with no usage (errors Claude Code writes itself) are passed over. */
export function contextTokens(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.isSidechain === true) continue
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      const post = e.compactMetadata?.postTokens
      return Number.isFinite(post) && post >= 0 ? post : null
    }
    if (e.type !== 'assistant') continue
    const used = inputTokens(e.message?.usage)
    if (used > 0) return used
  }
  return null
}

/** Tool results in a row at the end of `entries` without is_error, newest first; sawError tells whether the run ended
 *  at an error (so the count is exact) or at the start of what was read. */
export function killstreak(entries) {
  let n = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== 'user' || e.isSidechain === true) continue
    const blocks = e.message?.content
    if (!Array.isArray(blocks)) continue
    for (let j = blocks.length - 1; j >= 0; j--) {
      if (blocks[j]?.type !== 'tool_result') continue
      if (blocks[j].is_error === true) return { count: n, sawError: true }
      n++
    }
  }
  return { count: n, sawError: false }
}

/** The highest reward `n` has earned and the next one (null past the last). */
export function streakRank(n) {
  const earned = MILESTONES.findLast((m) => n >= m.at) ?? null
  const next = MILESTONES.find((m) => n < m.at) ?? null
  return { earned, next, toNext: next ? next.at - n : 0 }
}

/** The model's context window in tokens, from Claude Code's input or the model id; null when unknown. */
export function contextWindow(input) {
  const size = input?.context_window?.context_window_size
  if (Number.isFinite(size) && size > 0) return size
  const id = input?.model?.id
  if (typeof id !== 'string') return null
  for (const [pattern, tokens] of WINDOWS) if (pattern.test(id)) return tokens
  return null
}

/** Share of the window in use, 0-100; null when either side is unknown. */
export function contextPercent(tokens, window) {
  if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(window) || window <= 0) return null
  return Math.min(100, (tokens / window) * 100)
}

/** Text from outside (a folder name, the model's name) made safe to print: accents dropped, anything else that isn't
 *  printable ASCII (emoji, control characters, escapes) becomes "?". */
export function plain(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^\x20-\x7e]/gu, '?')
}

/** "850", "124K", "1M", "1.5M". */
export function tokensLabel(n) {
  if (!Number.isFinite(n)) return '--'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`
  return `${Number((n / 1_000_000).toFixed(1))}M`
}

/** Cells of the Matrix bar: `cells` katakana, the first `percent` of them lit as a falling drop (head brightest).
 *  The glyphs come from `seed`, so they change as the context does. */
export function rainBar(percent, cells, seed = 0) {
  const lit = percent == null ? 0 : Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells)
  return Array.from({ length: cells }, (_, i) => {
    const h = Math.imul((Math.imul(seed | 0, 31) + i + 1) | 0, 2654435761) >>> 0
    const glyph = KANA[((h ^ (h >>> 15)) >>> 0) % KANA.length] // >>> 0: a XOR is signed, and a negative index is no glyph
    const fromHead = lit - 1 - i
    const tone = i >= lit ? 'unlit' : fromHead === 0 ? 'head' : fromHead <= 2 ? 'bright' : fromHead <= 5 ? 'phosphor' : 'code'
    return { glyph, tone }
  })
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';')

/** One piece of the line in 24-bit colour, reset after. */
export function paint(text, style = {}) {
  if (!text) return ''
  const bg = style.bg ? `\x1b[48;2;${rgb(style.bg)}m` : ''
  const fg = style.fg ? `\x1b[38;2;${rgb(style.fg)}m` : ''
  return `${bg}${fg}${style.bold ? '\x1b[1m' : ''}${text}\x1b[0m`
}

/** The line from groups of [text, style] parts. Past `columns`, groups go by their `drop` rank, lowest first; groups
 *  without one always stay. Every printed character is one column, so the length is the width. */
export function compose(groups, columns) {
  let kept = groups.filter((g) => g.parts.length)
  const width = (gs) => gs.reduce((w, g) => w + g.parts.reduce((s, [text]) => s + text.length, 0), 0)
  if (Number.isFinite(columns) && columns > 0) {
    const ranks = [...new Set(kept.map((g) => g.drop).filter((d) => d != null))].sort((a, b) => a - b)
    for (const rank of ranks) {
      if (width(kept) <= columns) break
      kept = kept.filter((g) => g.drop !== rank)
    }
  }
  return kept.flatMap((g) => g.parts).map(([text, style]) => paint(text, style)).join('')
}

const pctLabel = (pct) => (pct == null ? '--%' : `${Math.round(pct)}%`)

function cyberpunk(s, p) {
  const [yellow, cyan, red, dim] = [p.accent, p.ansi[6], p.ansi[1], p.ansi[8]]
  const tone = s.percent == null ? dim : s.percent >= 85 ? red : s.percent >= 60 ? yellow : cyan
  const cells = 10
  const lit = s.percent == null ? 0 : Math.round((s.percent / 100) * cells)
  return [
    { parts: [[` ${s.model.toUpperCase()} `, { fg: p.bg, bg: yellow, bold: true }], ['╱', { fg: yellow }]] },
    {
      parts: [[' RAM ', { fg: cyan, bold: true }], ['┃'.repeat(lit), { fg: tone }], ['│'.repeat(cells - lit), { fg: dim }],
        [` ${pctLabel(s.percent)}`, { fg: tone, bold: true }]],
    },
    { parts: [[` ${tokensLabel(s.tokens)}/${tokensLabel(s.window)}`, { fg: dim }]], drop: 2 },
    { parts: s.dir ? [[' ╱ ', { fg: yellow }], [s.dir, { fg: p.fg }]] : [], drop: 1 },
  ]
}

function matrix(s, p) {
  const tones = { head: p.accent, bright: p.ansi[10], phosphor: p.fg, code: p.ansi[2], unlit: p.selection }
  const trail = p.ansi[8]
  return [
    { parts: [['> ', { fg: trail }], [s.model, { fg: p.fg, bold: true }], [' :: ', { fg: trail }]] },
    { parts: rainBar(s.percent, 12, s.tokens ?? 0).map(({ glyph, tone }) => [glyph, { fg: tones[tone] }]) },
    { parts: [[` ${pctLabel(s.percent)}`, { fg: p.accent, bold: true }]] },
    { parts: s.dir ? [[' :: ', { fg: trail }], [s.dir, { fg: p.fg }]] : [], drop: 1 },
  ]
}

function modernWarfare(s, p) {
  const [lime, amber, red, khaki, steel] = [p.accent, p.cursor, p.ansi[1], p.ansi[7], p.ansi[8]]
  const { earned, next, toNext } = streakRank(s.streak.count)
  const streak = `${String(s.streak.count).padStart(2, '0')}${s.streak.exact ? '' : '+'}`
  const ammo = s.percent == null ? null : 100 - s.percent
  return [
    { parts: [['[OP SVOBODEN]', { fg: amber, bold: true }]] },
    { parts: [[` ${s.model.toUpperCase()}`, { fg: lime, bold: true }]], drop: 4 },
    {
      parts: [[' > ', { fg: steel }], ['KILLSTREAK ', { fg: p.fg }], [streak, { fg: amber, bold: true }],
        ...(earned ? [[` ${earned.name}`, { fg: earned.at === LAST_MILESTONE ? red : lime, bold: true }]] : [])],
    },
    { parts: next ? [[' NEXT ', { fg: steel }], [`${next.name} ${toNext}`, { fg: khaki }]] : [], drop: 2 },
    { parts: [[' > ', { fg: steel }], ['AMMO ', { fg: p.fg }], [pctLabel(ammo), { fg: ammo != null && ammo < 15 ? red : amber, bold: true }]], drop: 3 },
    { parts: s.dir ? [[' > ', { fg: steel }], [s.dir, { fg: khaki }]] : [], drop: 1 },
  ]
}

const RENDER = { 'cyberpunk-2077': cyberpunk, matrix, 'modern-warfare-2': modernWarfare }

/** What the line shows, from Claude Code's input and its transcript's tail. */
export function gather(input, { steps = TAIL_STEPS } = {}) {
  const path = typeof input?.transcript_path === 'string' && input.transcript_path ? input.transcript_path : null
  let tokens = null
  let streak = { count: 0, exact: true }
  if (path) {
    for (const bytes of steps) {
      const tail = readTail(path, bytes)
      if (!tail) break
      const entries = parseTail(tail.text, tail.whole)
      const run = killstreak(entries)
      tokens = contextTokens(entries)
      streak = { count: run.count, exact: run.sawError || tail.whole }
      if (tail.whole || (tokens != null && (streak.exact || run.count > LAST_MILESTONE))) break
    }
  }
  if (tokens == null) tokens = inputTokens(input?.context_window?.current_usage) || null
  const window = contextWindow(input)
  const model = plain(input?.model?.display_name || input?.model?.id || 'Claude').trim() || 'Claude'
  const where = input?.workspace?.current_dir || input?.cwd
  const dir = typeof where === 'string' && where ? plain(basename(where)) : ''
  return { model, dir, tokens, window, percent: contextPercent(tokens, window), streak }
}

/** The status line for theme `slug`, or null when there is no such theme. */
export function render(slug, state, columns) {
  if (!Object.hasOwn(RENDER, slug) || !Object.hasOwn(PALETTES, slug)) return null
  return compose(RENDER[slug](state, PALETTES[slug]), columns)
}

function themeArg(argv) {
  const i = argv.indexOf('--theme')
  if (i >= 0) return argv[i + 1] ?? ''
  return argv.find((a) => a.startsWith('--theme='))?.slice('--theme='.length) ?? ''
}

async function readStdin() {
  if (process.stdin.isTTY) return {}
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  try {
    const input = JSON.parse(text)
    return input && typeof input === 'object' ? input : {}
  } catch {
    return {}
  }
}

export async function main(argv = process.argv.slice(2)) {
  const slug = themeArg(argv)
  const input = await readStdin()
  const line = render(slug, gather(input), Number(process.env.COLUMNS))
  // Printed on the status line itself, where a wrong --theme is seen; stderr would go nowhere.
  process.stdout.write(`${line ?? `statusline: unknown --theme "${plain(slug)}", use ${Object.keys(RENDER).join(', ')}`}\n`)
}

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) await main()
