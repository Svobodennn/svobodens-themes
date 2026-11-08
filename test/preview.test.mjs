import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatThemes, mergeThemes, PAGES, patchPage, unpatchPage } from '../scripts/preview.mjs'

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
