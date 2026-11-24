import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatThemes, linksAppThemes, mergeThemes, patchPage, PLAYGROUND_PAGE, unpatchPage } from '../scripts/preview.mjs'

// The pages Atalay's Terminal 0.19 links its theme sheets from; Orbiterm 0.27 adds feed.html and note.html.
const PAGES = ['index.html', 'messages.html', 'overlay.html']

const page = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<link rel="stylesheet" href="themes/mur47.css">\n</head>\n<body></body>\n</html>\n'
const block = (...sheets) => `<!-- pack -->${sheets.map((s) => `<link rel="stylesheet" href="themes/pack/${s}">`).join('')}<!-- /pack -->`

test('the pack links its sheets at the end of the head, once, however often it runs', () => {
  const once = patchPage(page, 'pack', ['a.css', 'b.css'])
  assert.equal(once, page.replace('</head>', `${block('a.css', 'b.css')}</head>`))
  assert.equal(patchPage(once, 'pack', ['a.css', 'b.css']), once)
  // A sheet dropped from the pack loses its link.
  assert.equal(patchPage(once, 'pack', ['a.css']), page.replace('</head>', `${block('a.css')}</head>`))
  assert.equal(patchPage(page.replace('</head>', '</HEAD>'), 'pack', ['a.css']), page.replace('</head>', `${block('a.css')}</HEAD>`))
})

test('a page it cannot patch safely stops it, rather than being mangled', () => {
  // A block started and never ended: cutting to a missing end would duplicate the head.
  assert.throws(() => patchPage(page.replace('</head>', '<!-- pack --></head>'), 'pack', ['a.css']), /has no "<!-- \/pack -->"/)
  assert.throws(() => patchPage('<html><body></body></html>', 'pack', ['a.css']), /no <\/head>/)
})

test("the pack's themes follow the app's, replacing its own earlier copies", () => {
  const theirs = [{ id: 'atalay' }, { id: 'svoboden-old' }, { id: 'mur47' }]
  assert.deepEqual(mergeThemes(theirs, [{ id: 'svoboden-a' }], 'svoboden').map((t) => t.id), ['atalay', 'mur47', 'svoboden-a'])
})

test('W7: undoing takes out only the marked block, and leaves a page without one as it was', () => {
  assert.equal(unpatchPage(patchPage(page, 'pack', ['a.css', 'b.css']), 'pack'), page)
  assert.equal(unpatchPage(page, 'pack'), page)
  assert.throws(() => unpatchPage(page.replace('</head>', '<!-- pack --></head>'), 'pack'), /has no "<!-- \/pack -->"/)
})

test("W2: a page is the pack's to patch when it links one of the app's own theme sheets, not only the pack's", () => {
  assert.equal(linksAppThemes(page, 'pack'), true)
  assert.equal(linksAppThemes(page.replace('href="themes/mur47.css"', "href='themes/emir.css'"), 'pack'), true)
  assert.equal(linksAppThemes(patchPage(page, 'pack', ['a.css']), 'pack'), true)
  // A page whose only theme links are the pack's own (its marked block), or with none at all.
  const bare = page.replace('<link rel="stylesheet" href="themes/mur47.css">\n', '')
  assert.equal(linksAppThemes(bare, 'pack'), false)
  assert.equal(linksAppThemes(patchPage(bare, 'pack', ['a.css']), 'pack'), false)
  assert.equal(linksAppThemes(page.replace('themes/mur47.css', 'style.css'), 'pack'), false)
  assert.equal(linksAppThemes(page.replace('themes/mur47.css', 'themes/themes.json'), 'pack'), false)
})

test("W7: undoing drops the pack's themes and keeps every other entry as it was", () => {
  const theirs = [{ id: 'atalay', bg: '#000000' }, { id: 'svoboden-a' }, { id: 'mur47', glow: true }, { id: 'svoboden-b' }]
  assert.deepEqual(mergeThemes(theirs, [], 'svoboden'), [{ id: 'atalay', bg: '#000000' }, { id: 'mur47', glow: true }])
})

test("W7: the themes file keeps the app's own layout, one theme a line, so undoing leaves the app's lines as they were", () => {
  const app = '[\n  {"id": "atalay", "ansi": ["#562f18", "#ff4d4d"], "ui": {"--font": "\\"Share Tech Mono\\", Menlo", "--a0": "#562f18"}, "glow": true},\n'
    + '  {"id": "mur47", "name": "MUR47"}\n]\n'
  assert.equal(formatThemes(JSON.parse(app)), app)
})

test('W7: --undo restores the checkout and touches nothing else there, or nothing at all on a broken page', () => {
  const script = fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url))
  const checkout = mkdtempSync(join(tmpdir(), 'svobodens-themes-undo-'))
  after(() => rmSync(checkout, { recursive: true, force: true }))
  const web = join(checkout, 'app/Resources/web')
  const folder = join(web, 'themes/svobodens-themes')
  mkdirSync(join(folder, 'fonts'), { recursive: true })
  writeFileSync(join(folder, 'a.css'), 'a{}')
  writeFileSync(join(web, 'hooks.js'), 'someone else\'s work\n')
  const theirs = [{ id: 'atalay' }, { id: 'mur47' }]
  const themesFile = join(web, 'themes/themes.json')
  const applied = formatThemes([...theirs, { id: 'svoboden-a' }])
  writeFileSync(themesFile, applied)
  const linked = patchPage(page, 'svobodens-themes', ['a.css'])
  for (const p of PAGES) writeFileSync(join(web, p), linked)

  // One page whose block never ends: nothing is written anywhere.
  writeFileSync(join(web, PAGES[1]), page.replace('</head>', '<!-- svobodens-themes --></head>'))
  const refused = spawnSync(process.execPath, [script, checkout, '--undo'], { encoding: 'utf8' })
  assert.equal(refused.status, 1, refused.stderr)
  assert.match(refused.stderr, new RegExp(`^${PAGES[1]}: `))
  assert.equal(readFileSync(themesFile, 'utf8'), applied)
  assert.equal(readFileSync(join(web, PAGES[0]), 'utf8'), linked)
  assert.ok(existsSync(folder))

  writeFileSync(join(web, PAGES[1]), linked)
  const run = spawnSync(process.execPath, [script, checkout, '--undo'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(themesFile, 'utf8'), formatThemes(theirs))
  for (const p of PAGES) assert.equal(readFileSync(join(web, p), 'utf8'), page, p)
  assert.ok(!existsSync(folder))
  assert.equal(readFileSync(join(web, 'hooks.js'), 'utf8'), 'someone else\'s work\n')
})

// Orbiterm keeps the Mac app in mac/ (0.23 on) and links the theme sheets from five pages; Atalay's Terminal 0.19 kept it
// in app/, with three.
const LAYOUTS = { mac: [...PAGES, 'feed.html', 'note.html'], app: PAGES }
for (const [layout, linking] of Object.entries(LAYOUTS)) {
  test(`the preview installs the pack in every page that links the app's theme sheets, its sounds where its themes point, and --undo takes them out (${layout}/)`, () => {
    const script = fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url))
    const root = fileURLToPath(new URL('..', import.meta.url))
    const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const checkout = mkdtempSync(join(tmpdir(), 'svobodens-themes-sfx-'))
    after(() => rmSync(checkout, { recursive: true, force: true }))
    const web = join(checkout, layout, 'Resources/web')
    mkdirSync(join(web, 'themes'), { recursive: true })
    writeFileSync(join(web, 'themes/themes.json'), formatThemes([{ id: 'atalay' }]))
    for (const p of linking) writeFileSync(join(web, p), page)
    // Left alone: a page without the app's theme sheets, the playground's own page (whatever it holds) and a page one
    // folder down. A page with the pack's block and no app sheet any more only loses the block.
    const bare = page.replace('<link rel="stylesheet" href="themes/mur47.css">\n', '')
    const alone = { 'mascot.html': bare, [PLAYGROUND_PAGE]: page, 'editor/index.html': page }
    mkdirSync(join(web, 'editor'))
    for (const [p, html] of Object.entries(alone)) writeFileSync(join(web, p), html)
    writeFileSync(join(web, 'old.html'), patchPage(bare, name, ['gone.css']))

    const run = spawnSync(process.execPath, [script, checkout], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    // The app plays a sound token's path from its web folder.
    const installed = JSON.parse(readFileSync(join(web, 'themes/themes.json'), 'utf8'))
    const paths = installed.flatMap((t) => Object.entries(t.ui ?? {}).filter(([k, v]) => k.startsWith('--sfx-') && v !== 'none').map(([, v]) => v))
    assert.ok(paths.length >= 20, `${paths.length} sounds`)
    for (const path of paths) {
      assert.ok(path.startsWith(`themes/${name}/sfx/`), path)
      assert.ok(readFileSync(join(web, path)).equals(readFileSync(join(root, 'themes/sfx', path.slice(`themes/${name}/sfx/`.length)))), path)
    }
    const sheets = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).contributes.themes.map((t) => t.css.slice('./themes/'.length))
    for (const p of linking) assert.equal(readFileSync(join(web, p), 'utf8'), patchPage(page, name, sheets), p)
    for (const [p, html] of Object.entries(alone)) assert.equal(readFileSync(join(web, p), 'utf8'), html, p)
    assert.equal(readFileSync(join(web, 'old.html'), 'utf8'), bare)
    assert.match(run.stdout, new RegExp(`linked in ${[...linking].sort().join(', ').replace(/\./g, '\\.')},`))

    // --undo goes by the pack's mark: a page that has it, app sheets or not.
    writeFileSync(join(web, 'old.html'), patchPage(bare, name, ['gone.css']))
    const undone = spawnSync(process.execPath, [script, checkout, '--undo'], { encoding: 'utf8' })
    assert.equal(undone.status, 0, undone.stderr)
    assert.ok(!existsSync(join(web, 'themes', name)))
    assert.equal(readFileSync(join(web, 'themes/themes.json'), 'utf8'), formatThemes([{ id: 'atalay' }]))
    for (const p of linking) assert.equal(readFileSync(join(web, p), 'utf8'), page, p)
    for (const [p, html] of Object.entries(alone)) assert.equal(readFileSync(join(web, p), 'utf8'), html, p)
    assert.equal(readFileSync(join(web, 'old.html'), 'utf8'), bare)
  })
}

test("W2: a checkout where no page links the app's theme sheets is refused, nothing written", () => {
  const script = fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url))
  const checkout = mkdtempSync(join(tmpdir(), 'svobodens-themes-nopages-'))
  after(() => rmSync(checkout, { recursive: true, force: true }))
  const web = join(checkout, 'mac/Resources/web')
  mkdirSync(join(web, 'themes'), { recursive: true })
  const themes = formatThemes([{ id: 'atalay' }])
  writeFileSync(join(web, 'themes/themes.json'), themes)
  writeFileSync(join(web, 'index.html'), page.replace('themes/mur47.css', 'style.css'))
  const run = spawnSync(process.execPath, [script, checkout], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /no page .* links the app's theme sheets/)
  assert.equal(readFileSync(join(web, 'themes/themes.json'), 'utf8'), themes)
  assert.ok(!existsSync(join(web, 'themes/svobodens-themes')))
})

test('the command line names Orbiterm: its usage, and a folder that is no checkout', () => {
  const script = fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url))
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /^usage: npm run preview -- <Orbiterm checkout> \[--undo\]/)
  const empty = mkdtempSync(join(tmpdir(), 'svobodens-themes-none-'))
  after(() => rmSync(empty, { recursive: true, force: true }))
  for (const args of [[empty], [empty, '--undo']]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /is not an Orbiterm checkout/)
  }
})
