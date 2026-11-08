import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildExtras, mix, ROOT, SLUGS, staleExtras, withPalettes } from '../extras/make-extras.mjs'
import { PALETTES } from '../extras/statusline/statusline.mjs'

test('every extras file is what the generator makes from the themes today', () => {
  assert.deepEqual(staleExtras(), [], 'run: node extras/make-extras.mjs')
})

test('the status line carries the themes\' own colours', () => {
  for (const slug of SLUGS) {
    const theme = JSON.parse(readFileSync(join(ROOT, 'themes', `${slug}.json`), 'utf8'))
    for (const key of ['bg', 'fg', 'cursor', 'selection', 'accent', 'ansi']) assert.deepEqual(PALETTES[slug][key], theme[key], `${slug}.${key}`)
  }
})

test('the generated files use only the palette\'s colours, plus mixes made from them', () => {
  const files = buildExtras()
  for (const slug of SLUGS) {
    const p = PALETTES[slug]
    const own = new Set([p.bg, p.fg, p.cursor, p.selection, p.accent, ...p.ansi])
    const mixes = new Set([0.07, 0.18, 0.2, 0.38, 0.42].flatMap((t) => [mix(p.fg, p.bg, t), mix(p.ansi[1], p.bg, t), mix(p.ansi[2], p.bg, t)]))
    for (const name of ['starship.toml', 'bat.tmTheme', 'delta.gitconfig', 'eza.yml']) {
      for (const hex of files[`extras/${slug}/${name}`].match(/#[0-9a-f]{6}\b/gi) ?? []) {
        assert.ok(own.has(hex) || mixes.has(hex), `extras/${slug}/${name}: ${hex} is not from the palette`)
      }
    }
  }
})

test('mixing two colours', () => {
  assert.equal(mix('#ffffff', '#000000', 0.5), '#808080')
  assert.equal(mix('#fe1038', '#0e0e17', 0), '#0e0e17')
  assert.equal(mix('#fe1038', '#0e0e17', 1), '#fe1038')
})

test('the palettes block is replaced, and a script without one is refused', () => {
  const src = 'a\n// palettes:begin (x)\nexport const PALETTES = {}\n// palettes:end\nb\n'
  assert.equal(withPalettes(src, { t: { ansi: ['#000000', '#ffffff'] } }),
    'a\n// palettes:begin (x)\nexport const PALETTES = {\n  "t": {\n    "ansi": ["#000000", "#ffffff"]\n  }\n}\n// palettes:end\nb\n')
  assert.throws(() => withPalettes('no block', {}), /palettes:begin/)
})
