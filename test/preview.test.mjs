import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeThemes, patchPage } from '../scripts/preview.mjs'

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
