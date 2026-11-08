import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkManifest, checkPack, checkSheet, checkTheme, cssRefs } from '../scripts/check.mjs'

// Dracula as the app ships it (its themes.json), under this pack's prefix: a theme the app takes as it is.
const theme = (over = {}) => ({
  id: 'svoboden-test', name: 'Test', bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a', accent: '#bd93f9',
  ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  ...over,
})
const entry = (over = {}) => ({ id: 'svoboden-test', label: 'Test', uiTheme: 'vs-dark', path: './themes/test.json', ...over })
const manifest = (themes = [entry()]) => ({
  name: 'svobodens-themes', displayName: "Svoboden's Themes", version: '0.0.1', publisher: 'svoboden',
  engines: { 'atalay-terminal': '>=0.16.0' }, categories: ['Themes'], contributes: { themes },
})

const roots = []
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))
const pack = (pkg, files) => {
  const root = mkdtempSync(join(tmpdir(), 'svobodens-themes-'))
  roots.push(root)
  mkdirSync(join(root, 'themes'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'themes', name)), { recursive: true })
    writeFileSync(join(root, 'themes', name), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return root
}

test('a theme the app ships passes, with the optional ui, glow and $schema', () => {
  assert.deepEqual(checkTheme(theme()), [])
  // MUR47's own ui overrides, as in the app's themes.json: colour, triplet and free-text tokens.
  const ui = {
    '--theme-id': 'mur47', '--font': '"Share Tech Mono", "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    '--accent-soft': '#9aab55', '--accent-soft-rgb': '154, 171, 85',
  }
  assert.deepEqual(checkTheme(theme({ ui, glow: true, $schema: '../schemas/theme.schema.json' })), [])
})

test('a ui colour token the native views cannot read is caught (they would draw it magenta)', () => {
  assert.deepEqual(checkTheme(theme({ ui: { '--accent-soft': '#9ab' } })), ['ui "--accent-soft" "#9ab" is not #rrggbb'])
  assert.deepEqual(checkTheme(theme({ ui: { '--a3': 'yellow' } })), ['ui "--a3" "yellow" is not #rrggbb'])
  assert.deepEqual(checkTheme(theme({ ui: { '--hue2': 'rgb(1,2,3)' } })), ['ui "--hue2" "rgb(1,2,3)" is not #rrggbb'])
  for (const bad of ['154, 171', '#9aab55', '300, 0, 0', 'rgb(154,171,85)']) {
    assert.deepEqual(checkTheme(theme({ ui: { '--panel-rgb': bad } })), [`ui "--panel-rgb" "${bad}" is not "r, g, b"`])
  }
  assert.deepEqual(checkTheme(theme({ ui: { '--panel-rgb': '0,0,0', '--a15': '#FFFFFF' } })), [])
})

test('a colour the app cannot read is caught', () => {
  for (const bad of ['#fff', 'red', '#gggggg', 'f88008', '#f880081', 16285704, null]) {
    assert.equal(checkTheme(theme({ accent: bad })).length, 1, `accent ${bad}`)
  }
  assert.deepEqual(checkTheme(theme({ bg: '#fff' })), ['bg "#fff" is not #rrggbb'])
})

test('ansi needs 16 readable colours', () => {
  assert.deepEqual(checkTheme(theme({ ansi: theme().ansi.slice(0, 15) })), ['ansi has 15 colours, needs 16'])
  assert.deepEqual(checkTheme(theme({ ansi: theme().ansi.with(3, 'yellow') })), ['ansi[3] "yellow" is not #rrggbb'])
  assert.deepEqual(checkTheme(theme({ ansi: '#ffffff' })), ['ansi is not a list'])
})

test('missing, misspelt and mistyped keys are caught', () => {
  const { accent, ...noAccent } = theme()
  assert.deepEqual(checkTheme(noAccent), ['missing "accent"'])
  assert.deepEqual(checkTheme(theme({ glo: true })), ['unknown key "glo"'])
  // In the app's themes file one value of the wrong type stops every theme loading, not only this one.
  assert.deepEqual(checkTheme(theme({ glow: 'true' })), ['glow is not true or false'])
  assert.deepEqual(checkTheme(theme({ ui: { accent: '#ffffff' } })), ['ui key "accent" is not a --token'])
  assert.deepEqual(checkTheme(theme({ ui: { '--accent': 1 } })), ['ui "--accent" is not a string'])
  assert.deepEqual(checkTheme(theme({ id: 'Svoboden Test' })), ['id "Svoboden Test" is not lowercase-with-dashes'])
  assert.deepEqual(checkTheme(theme({ $schema: 1 })), ['$schema is not a string'])
  assert.deepEqual(checkTheme(theme({ name: ' ' })), ['name is empty'])
  assert.deepEqual(checkTheme([]), ['not a JSON object'])
  // A value too deep to print is reported, not thrown.
  const deep = JSON.parse('['.repeat(20000) + ']'.repeat(20000))
  assert.deepEqual(checkTheme(theme({ id: deep })), ['id (unprintable) is not lowercase-with-dashes'])
})

test('the manifest lists each theme once, under the publisher, dark, from themes/', () => {
  assert.deepEqual(checkManifest(manifest()), [])
  assert.deepEqual(checkManifest(manifest([])), [])
  assert.deepEqual(checkManifest(manifest([entry({ id: 'dracula' })])),
    ['contributes.themes[0].id "dracula" does not start with "svoboden-"'])
  assert.deepEqual(checkManifest(manifest([entry(), entry({ path: './themes/other.json' })])),
    ['contributes.themes[1].id "svoboden-test" is listed twice'])
  assert.deepEqual(checkManifest(manifest([entry({ uiTheme: 'vs' })])),
    ['contributes.themes[0].uiTheme is not "vs-dark" (the app has dark themes only)'])
  assert.deepEqual(checkManifest(manifest([entry({ path: './themes/../package.json' })])),
    ['contributes.themes[0].path is not ./themes/<file>.json'])
  assert.deepEqual(checkManifest({ ...manifest(), categories: ['Other'] }), ['categories lacks "Themes"'])
})

test('the pack: every listed file there and agreeing with its entry, none left unlisted', () => {
  assert.deepEqual(checkPack(pack(manifest(), { 'test.json': theme() })), { errors: [], count: 1 })
  assert.deepEqual(checkPack(pack(manifest([]), {})), { errors: [], count: 0 })
  assert.deepEqual(checkPack(pack(manifest(), {})).errors, ['themes/test.json: listed in package.json but missing'])
  assert.deepEqual(checkPack(pack(manifest([]), { 'test.json': theme() })).errors, ['themes/test.json: not listed in package.json'])
  assert.deepEqual(checkPack(pack(manifest(), { 'test.json': theme({ name: 'Other' }) })).errors,
    ['themes/test.json: name "Other" is not package.json\'s label "Test"'])
  assert.deepEqual(checkPack(pack(manifest(), { 'test.json': theme({ id: 'svoboden-other' }) })).errors,
    ['themes/test.json: id "svoboden-other" is not package.json\'s "svoboden-test"'])
  assert.match(checkPack(pack(manifest(), { 'test.json': '{"id": ' })).errors[0], /^themes\/test\.json: /)
  const fileNotFolder = pack(manifest([]), {})
  rmSync(join(fileNotFolder, 'themes'), { recursive: true })
  writeFileSync(join(fileNotFolder, 'themes'), '')
  assert.deepEqual(checkPack(fileNotFolder).errors, ['themes: not a folder'])
})

test('a theme style sheet applies, and everything it loads is there and used', () => {
  const css = '@font-face{font-family:"Svb X";src:url("fonts/x.ttf")}'
    + `@container svb-root style(--theme-id: svoboden-test){#app::after{background:url('data:image/svg+xml,<g transform="scale(-1,1)"/>')}}`
  const withCss = manifest([entry({ css: './themes/test.css' })])
  const named = theme({ ui: { '--theme-id': 'svoboden-test' } })
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named, 'test.css': css, 'fonts/x.ttf': '' })).errors, [])
  // Without its --theme-id the sheet's rules wait for a theme that never comes.
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': theme(), 'test.css': css, 'fonts/x.ttf': '' })).errors,
    ['themes/test.css: never applies, themes/test.json has no ui "--theme-id": "svoboden-test"'])
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named, 'test.css': css })).errors, ['themes/test.css: url("fonts/x.ttf") is missing'])
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named })).errors, ['themes/test.css: listed in package.json but missing'])
  assert.deepEqual(checkPack(pack(manifest(), { 'test.json': theme(), 'test.css': css, 'fonts/x.ttf': '' })).errors,
    ['themes/test.css: not listed in package.json', 'themes/fonts/x.ttf: no theme\'s CSS uses it'])
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named, 'test.css': '@container style(--theme-id: svoboden-test){a{background:url(../../secret.png)}}' })).errors,
    ['themes/test.css: url("../../secret.png") leaves themes/'])
  assert.deepEqual(checkManifest(manifest([entry({ css: './themes/test.json' })])), ['contributes.themes[0].css is not ./themes/<file>.css'])
})

test('url() references: quoted or not, data URIs left out even with ")" inside', () => {
  const sheet = `a{src:url("fonts/a.ttf"),url('fonts/b.otf'),url(fonts/c.woff2);b:url('data:image/svg+xml,<g transform="scale(-1,1)"/>')}`
  assert.deepEqual(cssRefs(sheet), ['fonts/a.ttf', 'fonts/b.otf', 'fonts/c.woff2'])
  // A comment's url() is not a reference, and #fragments point into the page, not at a file.
  assert.deepEqual(cssRefs('/* fonts go in url("fonts/<file>") */a{mask:url(#m);src:url(fonts/a.ttf)}'), ['fonts/a.ttf'])
})

test('a sheet keeps every rule behind its own theme gate', () => {
  const id = 'svoboden-test'
  const gated = '@font-face{font-family:"Svb X";src:url("fonts/x.ttf")}@keyframes svb-x{to{opacity:0}}'
    + '#mapwrap { --theme-id: none; }html{container-name:svb-root}'
    + `@container style(--theme-id: ${id}){.tag{color:red}}@container svb-root style(--theme-id: ${id}){#app::after{content:"{"}}`
    + `.th-card[data-id="${id}"]::after, .th-card[data-id="${id}"] b{opacity:.5}`
  assert.deepEqual(checkSheet(gated, id), [])
  // Copied from another theme and not re-gated: it would dress that theme instead.
  assert.deepEqual(checkSheet('@container style(--theme-id: svoboden-other){a{b:c}}', id), ['gated on "svoboden-other", not on this theme'])
  // Outside any gate a rule restyles every theme.
  assert.deepEqual(checkSheet('.tag{x:y} *{cursor:none!important}', id), ['".tag" is outside the theme\'s gate', '"*" is outside the theme\'s gate'])
  assert.deepEqual(checkSheet('@keyframes pulse{to{opacity:0}}', id), ['"@keyframes pulse" is outside the theme\'s gate'])
  // WebKit leaves a pseudo-element under an unnamed gate on screen after the theme changes.
  assert.deepEqual(checkSheet(`@container style(--theme-id: ${id}){.tag{x:y}@media (prefers-reduced-motion: no-preference){#app::before{x:y}}}`, id),
    ['"#app::before" needs the svb-root gate (a pseudo-element)'])
  assert.deepEqual(checkSheet(`@container style(--theme-id: ${id}){@keyframes svb-a{from{x:y}}.panel:after{x:y}}`, id),
    ['".panel:after" needs the svb-root gate (a pseudo-element)'])
  // A media condition around the gate keeps it gated; around a bare rule it doesn't.
  assert.deepEqual(checkSheet(`@media (prefers-reduced-motion: no-preference){@container style(--theme-id: ${id}){a{b:c}}}`, id), [])
  assert.deepEqual(checkSheet('@media (min-width:1px){a{b:c}}', id), ['"a" is outside the theme\'s gate'])
  assert.deepEqual(checkSheet(`.th-card[data-id="${id}"], .tag{x:y}`, id), [`".th-card[data-id="${id}"], .tag" is outside the theme's gate`])
  assert.deepEqual(checkSheet('@import url(x.css);', id), ['"@import url(x.css);" is outside the theme\'s gate'])
})

test('the pack: gating, borrowed ids, refs outside the sheet, and no cascade from a broken theme file', () => {
  const css = '@font-face{font-family:"Svb X";src:url("fonts/x.ttf")}'
  const withCss = manifest([entry({ css: './themes/test.css' })])
  const named = theme({ ui: { '--theme-id': 'svoboden-test' } })
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named, 'test.css': 'a{b:c}' })).errors, ['themes/test.css: "a" is outside the theme\'s gate'])
  // The app loads pages from file://, where "/fonts/x.ttf" is the disk's root.
  assert.deepEqual(checkPack(pack(withCss, { 'test.json': named, 'test.css': '@font-face{src:url(/fonts/x.ttf)}', 'fonts/x.ttf': '' })).errors,
    ['themes/test.css: url("/fonts/x.ttf") is not relative to the sheet', 'themes/fonts/x.ttf: no theme\'s CSS uses it'])
  // A theme without a sheet that names another theme's id would wear that theme's sheet.
  const two = manifest([entry({ css: './themes/test.css' }), entry({ id: 'svoboden-b', label: 'B', path: './themes/b.json' })])
  const b = theme({ id: 'svoboden-b', name: 'B', ui: { '--theme-id': 'svoboden-test' } })
  assert.deepEqual(checkPack(pack(two, { 'test.json': named, 'test.css': css, 'fonts/x.ttf': '', 'b.json': b })).errors,
    ['themes/b.json: ui "--theme-id" "svoboden-test" is not its own id "svoboden-b"'])
  // A theme file that doesn't parse is one error, not three.
  const broken = checkPack(pack(withCss, { 'test.json': '{"id": ', 'test.css': css, 'fonts/x.ttf': '' })).errors
  assert.equal(broken.length, 1, broken.join('\n'))
  assert.match(broken[0], /^themes\/test\.json: /)
})

test('the command fails on a broken pack, even started through a symlink', () => {
  const broken = pack({}, {})
  const dir = mkdtempSync(join(tmpdir(), 'svobodens-themes-link-'))
  const link = join(dir, 'pack')
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), link)
  try {
    for (const script of [fileURLToPath(new URL('../scripts/check.mjs', import.meta.url)), join(link, 'scripts', 'check.mjs')]) {
      const run = spawnSync(process.execPath, [script, broken], { encoding: 'utf8' })
      assert.equal(run.status, 1, script)
      assert.match(run.stderr, /^package\.json: name is not lowercase-with-dashes$/m)
    }
  } finally {
    unlinkSync(link) // the link itself, never what it points at (this project)
    roots.push(dir)
  }
})
