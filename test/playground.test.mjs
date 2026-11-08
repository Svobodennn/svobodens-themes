import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assembleCss, codicons, CSS_SLOT, FRAMES, frameDoc, FRIEND_SLOT, OWN_REFRESH, pageParts, swiftTheme } from '../scripts/playground.mjs'
import { themeCss, UI_FONTS } from '../scripts/derive.mjs'

// ThemeStore.script as Atalay's Terminal 0.19.0 has it, and as the theme hooks change it (Themes.swift).
const swift = (body, rule = '') => `    var css: String {
        return ":root:root{}"${rule ? `\n            + "${rule}"` : ''}
    }

    private var script: WKUserScript {
        let source = """
        \\(Self.marker)(() => {
          const s = document.createElement('style');
          s.textContent = \\(Self.jsString(css));
          document.documentElement.appendChild(s);
${body}
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }`
const SWAP = 'html.theme-swap *::before,html.theme-swap *::after{--theme-swap:1}'
const OLD = "          window.__theme = (css) => { s.textContent = css; window.dispatchEvent(new Event('themechange')); };"
const HOOKS = `          window.__theme = (css, id) => {
            s.textContent = css;
            const h = document.documentElement;
            h.classList.add('theme-swap');
            void h.offsetHeight;
            h.classList.remove('theme-swap');
            window.dispatchEvent(new CustomEvent('themechange', { detail: { id } }));
          };`

test("the app's theme script comes out of the Swift as the JS WebKit runs, the sheet's place marked", () => {
  const t = swiftTheme(swift(OLD))
  assert.ok(t.js.startsWith("/* atalay-theme */(() => {\n  const s = document.createElement('style');"))
  assert.ok(t.js.includes(`s.textContent = ${CSS_SLOT};`))
  assert.ok(t.js.includes(OLD.trimStart()))
  assert.equal(t.refresh, false)
  assert.equal(t.rule, null)
  // It runs: the style goes in, __theme replaces its text.
  const doc = { documentElement: { appendChild: (el) => (doc.style = el) }, createElement: () => ({ textContent: '' }) }
  const win = { dispatchEvent: () => {} }
  new Function('document', 'window', 'Event', t.js.replace(CSS_SLOT, '"a{}"'))(doc, win, class {})
  assert.equal(doc.style.textContent, 'a{}')
  win.__theme('b{}')
  assert.equal(doc.style.textContent, 'b{}')
})

test("an app whose __theme refreshes the pseudo-elements is seen as one, with the rule its sheet ends with", () => {
  const t = swiftTheme(swift(HOOKS, SWAP))
  assert.equal(t.refresh, true)
  assert.equal(t.rule, SWAP)
  // The class without the forced layout, or the rule without the class, is no refresh.
  assert.equal(swiftTheme(swift(HOOKS.replace('void h.offsetHeight;', ''), SWAP)).refresh, false)
  assert.equal(swiftTheme(swift(OLD, SWAP)).refresh, false)
})

test('a Swift shaped otherwise gives nothing, rather than a broken script', () => {
  assert.equal(swiftTheme('struct Nothing {}'), null)
  assert.equal(swiftTheme(swift(OLD).replace('\\(Self.jsString(css))', '\\(other)')), null)
  assert.equal(swiftTheme(swift(OLD).replace('window.__theme =', 'window.theme =')), null)
})

test('the page assembles each theme as ThemeStore.css does, for every font and with or without the refresh', () => {
  const spec = { id: 't', name: 'T', bg: '#101820', fg: '#e0e0e0', cursor: '#ffffff', selection: '#334455', accent: '#ff8800', ansi: [], glow: true }
  const def = { ...spec, id: 'd', glow: false }
  const base = themeCss(spec, def)
  for (const { id, css } of UI_FONTS) {
    for (const refresh of [false, true]) assert.equal(assembleCss(base, css, refresh ? SWAP : null), themeCss(spec, def, { uiFont: id, refresh }), `${id} ${refresh}`)
  }
})

const PAGE = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="style.css">
<style>html{background:transparent}</style>
<!-- pack --><link rel="stylesheet" href="themes/pack/a.css"><!-- /pack --></head>
<body class="overlay">
<div id="toast"></div>
<script src="hooks.js"></script>
<script src="app.js"></script>
<script>window.ready = 1;</script>
<script src="layout.js"></script>
</body>
</html>`

test("a page's parts: its head without the preview's links, its markup without scripts, its scripts in order", () => {
  const p = pageParts(PAGE, 'pack')
  assert.equal(p.htmlAttrs, ' lang="en"')
  assert.equal(p.bodyAttrs, ' class="overlay"')
  assert.ok(p.head.includes('<link rel="stylesheet" href="style.css">') && p.head.includes('<style>html{background:transparent}</style>'))
  assert.ok(!p.head.includes('themes/pack/a.css'))
  assert.equal(p.body.trim(), '<div id="toast"></div>')
  assert.deepEqual(p.scripts, [{ src: 'hooks.js' }, { src: 'app.js' }, { code: 'window.ready = 1;' }, { src: 'layout.js' }])
  assert.throws(() => pageParts('<html></html>', 'pack'), /no <head> or <body>/)
})

test("a frame: the app's theme script first, the page's head, the pack's sheets after it, and only the scripts it runs", () => {
  const parts = pageParts(PAGE, 'pack')
  const dash = FRAMES.find((f) => f.name === 'dash')
  const doc = frameDoc({ frame: dash, parts, theme: `/*THEME*/${CSS_SLOT}`, ownRefresh: false, pack: 'pack', sheets: ['a.css', 'b.css'], prelude: "/*FIRST '__FRAME__' '__ROLE__'*/", postlude: '/*LAST*/' })
  const order = ['/*FIRST "dash" ""*/', '/*THEME*/', "r.insertBefore(s, r.firstChild)", 'href="style.css"',
    '<!-- pack --><link rel="stylesheet" href="themes/pack/a.css"><link rel="stylesheet" href="themes/pack/b.css"><!-- /pack -->', '</head>',
    '<div id="toast"></div>', '<script src="hooks.js">', '<script src="layout.js">', '/*LAST*/']
  order.reduce((at, s) => {
    const i = doc.indexOf(s, at)
    assert.ok(i > at - 1, `${s} in order`)
    return i
  }, 0)
  assert.ok(!doc.includes('app.js') && !doc.includes('window.ready'))
  assert.ok(!doc.includes(OWN_REFRESH.rule))
  const all = frameDoc({ frame: { name: 'overlay', run: 'all' }, parts, theme: '', ownRefresh: true, pack: 'pack', sheets: [], prelude: '', postlude: '' })
  assert.ok(all.includes('<script src="app.js">') && all.includes('window.ready = 1;') && all.includes(OWN_REFRESH.rule))
})

test("the activity bar's icons come from git.js's code point table", () => {
  const cp = codicons("  const CP = {\n    'chevron-down': 0xeab4, repo: 0xea62,\n    files: 0xeaf0, 'symbol-color': 0xeb5c,\n  };")
  assert.deepEqual(cp, { 'chevron-down': 0xeab4, repo: 0xea62, files: 0xeaf0, 'symbol-color': 0xeb5c })
  assert.deepEqual(codicons('no table'), {})
})

test("a friend's chat is messages.html as a chat panel, its friend filled into the first script when it opens", () => {
  const chat = FRAMES.find((f) => f.name === 'chat')
  assert.deepEqual([chat.page, chat.role, chat.run], ['messages.html', 'chat', 'all'])
  const prelude = readFileSync(new URL('../scripts/playground/frame.js', import.meta.url), 'utf8')
  const doc = frameDoc({ frame: chat, parts: pageParts(PAGE, 'pack'), theme: '', ownRefresh: false, pack: 'pack', sheets: [], prelude, postlude: '' })
  assert.ok(doc.includes(`const FRIEND = ${FRIEND_SLOT};`) && doc.includes("const ROLE = \"chat\";"))
  // As Swift's first script: the role and the friend, before anything of the page runs.
  const win = {}
  const first = doc.slice(doc.indexOf('(() => {'), doc.indexOf('})();') + 5).replace(FRIEND_SLOT, '"f-vee"')
  new Function('window', 'addEventListener', 'console', first)(win, () => {}, { error() {} })
  assert.equal(win.__MESSAGES_ROLE__, 'chat')
  assert.equal(win.__MESSAGES_FRIEND__, 'f-vee')
})
