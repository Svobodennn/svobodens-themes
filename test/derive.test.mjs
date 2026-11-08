import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { derive, parse, themeCss, tokensOf } from '../scripts/derive.mjs'

// Made once by the earlier Python port of the same Swift (see its "about"): upstream 0.19.0's themes and this pack's.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/derive-python.json', import.meta.url), 'utf8'))
const all = [...fixture.app, ...fixture.pack]
const DEFAULT = fixture.app[0]

const ANSI = ['#101010', '#cc3333', '#33cc33', '#cccc33', '#3333cc', '#cc33cc', '#33cccc', '#cccccc',
  '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff']
const spec = (over = {}) => ({ id: 't', name: 'T', bg: '#000000', fg: '#ffffff', cursor: '#ffffff', selection: '#444444', accent: '#ff8800', ansi: ANSI, ...over })

test("every theme's tokens match the Python port's, for upstream 0.19.0 and this pack", () => {
  assert.equal(fixture.app.length, 14)
  for (const t of all) assert.deepEqual(tokensOf(t), fixture.tokens[t.id], t.id)
})

test("the style sheet matches the Python port's (the default, a plain theme, one with ui values, one that glows)", () => {
  assert.ok(Object.keys(fixture.css).length >= 4)
  for (const [id, css] of Object.entries(fixture.css)) assert.equal(themeCss(all.find((t) => t.id === id), DEFAULT), css, id)
})

test('the surfaces come only as triplets, a few colours as both, the rest as hex (77 tokens)', () => {
  const t = derive(spec())
  for (const k of ['deep', 'surface', 'panel', 'glass-top']) {
    assert.equal(t[`--${k}`], undefined, k)
    assert.match(t[`--${k}-rgb`], /^\d+, \d+, \d+$/, k)
  }
  for (const k of ['bg', 'accent', 'accent-soft', 'violet', 'cyan', 'warn', 'amber', 'red', 'green', 'dim2', 'ink']) {
    assert.match(t[`--${k}`], /^#[0-9a-f]{6}$/, k)
    assert.ok(t[`--${k}-rgb`], k)
  }
  assert.equal(t['--txt-rgb'], undefined)
  assert.equal(Object.keys(t).length, 77)
})

test('the palette passes through untouched where the Swift takes it as it is', () => {
  const t = derive(spec())
  ANSI.forEach((c, i) => assert.equal(t[`--a${i}`], c))
  assert.equal(t['--code-bg'], '#000000')
  assert.equal(t['--code-fg'], '#ffffff')
  assert.equal(t['--caret-text'], '#000000')
  assert.equal(t['--accent'], '#ff8800')
  assert.equal(t['--red'], '#cc3333')
  // A black background darkened stays black.
  assert.equal(t['--bg'], '#000000')
  assert.equal(t['--deep-rgb'], '0, 0, 0')
  // The session hues are other tokens, in the order the orbit map uses them.
  const from = ['accent-soft', 'cyan', 'violet', 'green', 'orange', 'blue', 'amber', 'lime', 'magenta', 'txt']
  from.forEach((k, i) => assert.equal(t[`--hue${i}`], t[`--${k}`], `hue${i}`))
})

test('"your turn" goes green when the accent has the cyan\'s hue, and not for a grey accent', () => {
  assert.equal(derive(spec({ accent: '#33d0d0' }))['--cyan'], '#33cc33')
  assert.equal(derive(spec({ accent: '#ff8800' }))['--cyan'], '#33cccc')
  assert.equal(derive(spec({ accent: '#808080' }))['--cyan'], '#33cccc')
})

test("ink is whichever of the darkened background and lightened text stands out more on the accent", () => {
  assert.equal(derive(spec({ accent: '#ffff00' }))['--ink'], '#000000')
  assert.equal(derive(spec({ accent: '#101010' }))['--ink'], '#ffffff')
})

test("the selection's text is the background on a light selection, the text colour on a dark one", () => {
  assert.equal(derive(spec({ bg: '#102030', selection: '#ffffff' }))['--selection-text'], '#102030')
  assert.equal(derive(spec({ fg: '#eeddcc', selection: '#000000' }))['--selection-text'], '#eeddcc')
})

test('what it cannot read falls back as the Swift does: the text colour for ANSI, black and white for the rest', () => {
  const short = derive(spec({ fg: '#abcdef', ansi: ['#123456', 'not a colour'] }))
  assert.equal(short['--a0'], '#123456')
  assert.equal(short['--a1'], '#abcdef')
  assert.equal(short['--a15'], '#abcdef')
  const bad = derive(spec({ bg: 'nope', fg: '#12345', accent: '' }))
  assert.equal(bad['--code-bg'], '#000000')
  assert.equal(bad['--code-fg'], '#ffffff')
  assert.equal(bad['--accent'], '#ffffff')
  assert.equal(bad['--code-cursor'], '#ffffff')
})

test('colours read as #rrggbb or "r, g, b"; out-of-range values clamp only when written', () => {
  assert.deepEqual(parse('36, 18, 0'), parse('#241200'))
  assert.deepEqual(parse('  #241200\t'), parse('#241200'))
  assert.equal(parse('#2412'), null)
  assert.equal(parse('1, 2'), null)
  assert.equal(parse('rgb(1, 2, 3)'), null)
  // Swift's split skips the empty part, so this is still three numbers.
  assert.deepEqual(parse('36,,18, 0'), parse('#241200'))
  assert.equal(derive(spec({ ansi: ['300, -20, 0'] }))['--a0'], '#ff0000')
})

test("a theme's ui values win over what its palette makes", () => {
  const t = tokensOf(spec({ ui: { '--theme-id': 'mine', '--accent': '#010203' } }))
  assert.equal(t['--theme-id'], 'mine')
  assert.equal(t['--accent'], '#010203')
  assert.equal(derive(spec({ ui: { '--accent': '#010203' } }))['--accent'], '#ff8800')
})

test('the sheet: sorted tokens on the root, the default theme on the orbit map, glow, font and refresh only when asked', () => {
  const plain = themeCss(spec(), spec({ id: 'd', accent: '#00ff00' }))
  assert.ok(plain.startsWith(':root:root{--a0:#101010;--a1:#cc3333;--a10:#55ff55;'))
  const map = plain.slice(plain.indexOf('#mapwrap#mapwrap{'))
  assert.ok(map.includes('--accent:#00ff00;'))
  assert.ok(map.endsWith('radial-gradient(ellipse at 50% 40%,var(--bloom) 0%,var(--bg) 70%) fixed}'))
  assert.ok(!plain.includes('text-shadow'))
  assert.ok(themeCss(spec({ glow: true }), spec()).includes('body{text-shadow:0 0 1px rgba(255,255,255,0.3)'))
  assert.ok(!themeCss(spec({ glow: 'yes' }), spec()).includes('text-shadow'))
  assert.ok(themeCss(spec(), spec(), { uiFont: 'system' }).endsWith(':root:root{--font:-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;--font-sans:-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif}'))
  assert.ok(themeCss(spec(), spec(), { refresh: true }).endsWith('html.theme-swap *::before,html.theme-swap *::after{--theme-swap:1}'))
})
