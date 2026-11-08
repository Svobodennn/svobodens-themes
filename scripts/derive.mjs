// The app's theme tokens and theme style sheet, as Atalay's Terminal makes them (ThemeStore.derive, tokens(of:) and css
// in app/Sources/AtalayTerminal/Themes.swift, 0.19.0): every colour the pages use comes from a theme's terminal palette
// and accent, mixed in Oklab, and reaches each page as one <style> written before it loads. Ported line for line, so
// the playground shows a theme in exactly the colours the app would; test/derive.test.mjs holds it to the app's output.

/** The interface fonts Settings offers (ThemeStore.uiFonts): the monospace adds nothing to the sheet. */
export const UI_FONTS = [
  { id: 'mono', css: null },
  { id: 'system', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  { id: 'rounded', css: 'ui-rounded, "SF Pro Rounded", -apple-system, "Segoe UI", sans-serif' },
]

// Swift's global max and min (Comparable): a NaN gives the other side back, where Math.max would pass it on.
const swiftMax = (x, y) => (y >= x ? y : x)
const swiftMin = (x, y) => (y < x ? y : x)
const byte = (v) => Math.round(swiftMin(1, swiftMax(0, v)) * 255)
const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/** A colour in sRGB, 0–1 a channel (RGB in Themes.swift). */
export class RGB {
  constructor(r, g, b) {
    this.r = r
    this.g = g
    this.b = b
  }
  get hex() {
    return `#${[this.r, this.g, this.b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`
  }
  get triplet() {
    return `${byte(this.r)}, ${byte(this.g)}, ${byte(this.b)}`
  }
  get luminance() {
    return 0.2126 * linear(this.r) + 0.7152 * linear(this.g) + 0.0722 * linear(this.b)
  }
  contrast(o) {
    const a = this.luminance
    const b = o.luminance
    return (swiftMax(a, b) + 0.05) / (swiftMin(a, b) + 0.05)
  }
  get lab() {
    const lr = linear(this.r)
    const lg = linear(this.g)
    const lb = linear(this.b)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    return new Lab(
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    )
  }
  static fromLab(lab) {
    const l = Math.pow(lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3)
    const m = Math.pow(lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3)
    const s = Math.pow(lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b, 3)
    return new RGB(
      gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    )
  }
  /** `k` of the way from this colour to `o`, in Oklab. */
  mix(o, k) {
    const x = this.lab
    const y = o.lab
    return RGB.fromLab(new Lab(x.L + (y.L - x.L) * k, x.a + (y.a - x.a) * k, x.b + (y.b - x.b) * k))
  }
}

/** A colour in Oklab. */
export class Lab {
  constructor(L, a, b) {
    this.L = L
    this.a = a
    this.b = b
  }
  get chroma() {
    return Math.hypot(this.a, this.b)
  }
  distance(o) {
    return Math.sqrt(Math.pow(this.L - o.L, 2) + Math.pow(this.a - o.a, 2) + Math.pow(this.b - o.b, 2))
  }
  /** Degrees between two hues, 180 when either is a grey. */
  hueDistance(o) {
    if (!(this.chroma > 0.03 && o.chroma > 0.03)) return 180
    const d = (Math.abs(Math.atan2(this.b, this.a) - Math.atan2(o.b, o.a)) * 180) / Math.PI
    return d > 180 ? 360 - d : d
  }
}

// Swift's CharacterSet.whitespaces: tabs and the space separators, not line ends.
const trimWhitespace = (s) => s.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, '')
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** "#rrggbb" or "r, g, b" (ThemeStore.parse); null for anything else. Like Swift's split, empty parts are skipped and
 *  parts that aren't numbers dropped before the three are counted. */
export function parse(value) {
  if (typeof value !== 'string') return null
  const v = trimWhitespace(value)
  if (v.startsWith('#') && [...v].length === 7 && /^#[0-9a-fA-F]{6}$/.test(v)) {
    const n = parseInt(v.slice(1), 16)
    return new RGB(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255)
  }
  const parts = v
    .split(',')
    .filter((p) => p !== '')
    .map((p) => trimWhitespace(p))
    .filter((p) => DECIMAL.test(p))
    .map(Number)
  return parts.length === 3 ? new RGB(parts[0] / 255, parts[1] / 255, parts[2] / 255) : null
}

const ONLY_RGB = new Set(['deep', 'surface', 'panel', 'glass-top'])
const ALSO_RGB = new Set(['bg', 'accent', 'accent-soft', 'violet', 'cyan', 'warn', 'amber', 'red', 'green', 'dim2', 'ink'])
const HUES = ['accent-soft', 'cyan', 'violet', 'green', 'orange', 'blue', 'amber', 'lime', 'magenta', 'txt']

/** Every token a theme's palette makes (ThemeStore.derive), before its own `ui` values. */
export function derive(spec) {
  const black = new RGB(0, 0, 0)
  const white = new RGB(1, 1, 1)
  const T = parse(spec.bg) ?? black
  const F = parse(spec.fg) ?? white
  const A = parse(spec.accent) ?? white
  const ansi = Array.isArray(spec.ansi) ? spec.ansi : []
  const N = Array.from({ length: 16 }, (_, i) => (i < ansi.length ? (parse(ansi[i]) ?? F) : F))
  const same = (a, b) => a.lab.distance(b.lab) < 0.04
  // A bright colour that is only a grey (Solarized's are its greys), or the same as the normal one, is the normal one
  // lightened.
  const bright = (i) => {
    const n = N[i]
    const b = N[i + 8]
    return b.lab.chroma < n.lab.chroma * 0.5 || same(n, b) ? n.mix(white, 0.18) : b
  }
  const t = new Map()
  t.set('bg', T.mix(black, 0.45))
  t.set('deep', T.mix(black, 0.8))
  t.set('surface', T.mix(black, 0.32))
  t.set('panel', T.mix(black, 0.18))
  t.set('glass-top', T.mix(A, 0.12))
  t.set('bloom', T.mix(black, 0.12))
  t.set('accent', A)
  t.set('accent-soft', A.mix(white, 0.35))
  t.set('accent-pale', A.mix(white, 0.65))
  t.set('txt', F)
  t.set('hi', F.mix(white, 0.5))
  t.set('title', F.mix(white, 0.25))
  t.set('txt2', F.mix(T, 0.15))
  t.set('txt3', F.mix(T, 0.3))
  t.set('dim', F.mix(T, 0.45))
  t.set('faint', F.mix(T, 0.58))
  t.set('dim2', F.mix(T, 0.72))
  const dark = T.mix(black, 0.6)
  const light = F.mix(white, 0.6)
  t.set('ink', A.contrast(dark) >= A.contrast(light) ? dark : light)
  t.set('red', N[1])
  t.set('red-soft', N[1].mix(white, 0.35))
  t.set('warn', same(N[1], bright(1)) ? N[1].mix(N[5], 0.3) : bright(1))
  t.set('green', N[2])
  t.set('amber', N[3])
  t.set('blue', N[4])
  t.set('violet', N[5])
  // "Your turn" must not look like "working" (the accent): with an accent of the cyan's hue it goes green.
  t.set('cyan', A.lab.hueDistance(N[6].lab) < 30 ? N[2] : N[6])
  t.set('lime', same(N[2], bright(2)) ? N[2].mix(N[3], 0.4) : bright(2))
  t.set('sky', same(N[4], bright(4)) ? N[4].mix(N[6], 0.5) : bright(4))
  t.set('magenta', same(N[5], bright(5)) ? N[5].mix(N[1], 0.3) : bright(5))
  t.set('orange', N[1].mix(N[3], 0.5))
  t.set('lavender', N[5].mix(F, 0.5))
  t.set('idle-deep', t.get('bg').mix(t.get('cyan'), 0.08))
  t.set('ended', F.mix(T, 0.62))
  t.set('ended-deep', t.get('dim2').mix(t.get('bg'), 0.6))
  HUES.forEach((k, i) => t.set(`hue${i}`, t.get(k)))
  t.set('code-bg', T)
  t.set('code-fg', F)
  t.set('code-cursor', parse(spec.cursor) ?? F)
  const sel = parse(spec.selection) ?? A
  t.set('selection', sel)
  t.set('selection-text', sel.luminance > 0.4 ? T : F)
  t.set('caret-text', T)
  for (let i = 0; i < 16; i++) t.set(`a${i}`, N[i])

  const out = {}
  for (const [k, c] of t) {
    if (!ONLY_RGB.has(k)) out[`--${k}`] = c.hex
    if (ONLY_RGB.has(k) || ALSO_RGB.has(k)) out[`--${k}-rgb`] = c.triplet
  }
  return out
}

/** A theme's tokens as the app uses them (ThemeStore.tokens(of:)): what its palette makes, its `ui` values over them. */
export function tokensOf(spec) {
  const t = derive(spec)
  const ui = spec.ui && typeof spec.ui === 'object' ? spec.ui : {}
  for (const [k, v] of Object.entries(ui)) t[k] = v
  return t
}

// Swift's String < on these ASCII names: by code unit.
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
const decl = (t) =>
  Object.entries(t)
    .sort(byKey)
    .map(([k, v]) => `${k}:${v};`)
    .join('')

/** The style sheet the app writes into every page for `spec` (ThemeStore.css): its tokens on the root, the default
 *  theme's again on the orbit map, a neon theme's glow, the interface font Settings picked (`uiFont`: mono, system or
 *  rounded). `refresh`: the line a checkout with the theme hooks adds for __theme's pseudo-element refresh
 *  (`html.theme-swap …`), or false for a 0.19.0 app without it. */
export function themeCss(spec, defaultSpec, { uiFont = 'mono', refresh = false } = {}) {
  const font = UI_FONTS.find((f) => f.id === uiFont)?.css
  return (
    `:root:root{${decl(tokensOf(spec))}}#mapwrap#mapwrap{${decl(tokensOf(defaultSpec))}` +
    '--panel:rgba(var(--panel-rgb),var(--glass-a));--line:rgba(var(--accent-rgb),0.32);--line-soft:rgba(var(--accent-rgb),0.13);' +
    'color:var(--txt);background:linear-gradient(rgba(var(--bg-rgb),0.6),rgba(var(--bg-rgb),0.6)),' +
    'radial-gradient(ellipse at 50% 40%,var(--bloom) 0%,var(--bg) 70%) fixed}' +
    (spec.glow === true ? 'body{text-shadow:0 0 1px rgba(255,255,255,0.3),0 0 5px currentColor,0 0 12px rgba(var(--accent-rgb),0.5)}' : '') +
    (font ? `:root:root{--font:${font};--font-sans:${font}}` : '') +
    (refresh === true ? 'html.theme-swap *::before,html.theme-swap *::after{--theme-swap:1}' : typeof refresh === 'string' ? refresh : '')
  )
}
