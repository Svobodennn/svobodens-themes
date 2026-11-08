#!/usr/bin/env node
// The theme playground: one page in an Atalay's Terminal checkout's web folder (app/Resources/web/svobodens-playground
// .html) that shows the pack's themes in the states the dev build makes hard to reach: the notices, a chat that needs
// you, the boot screen, the level-up takeover, the theme screen, the menus, and the theme hooks' attributes. Open it in
// Safari, the engine of the app's WKWebView.
//   - three frames, the dashboard (index.html), the notices (messages.html) and the overlay (overlay.html), each with
//     its page's own style sheets and the pack's, and the theme style the app writes (Themes.swift's script, read from
//     the checkout), switched as the app switches it (window.__theme);
//   - the notices and the overlay run their pages' own scripts, the app's bridge answered by the playground; the
//     dashboard runs only its self-contained ones (hooks.js, xp.js, social.js, sfx.js, layout.js) and takes the rest as
//     markup copied from the app's functions (playground/mocks.js);
//   - sounds, the app's and the theme's (its --sfx tokens), play through each page's own sfx.js and hooks.js, only while
//     the panel's sound box is ticked;
//   - the pack's sheets and fonts are copied into web/themes/<pack>/ as `npm run preview` does; no tracked file of the
//     checkout is touched.
// Usage: npm run playground -- <atalay-terminal checkout>
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from './check.mjs'
import { copyPack, mergeThemes } from './preview.mjs'
import { themeCss, tokensOf, UI_FONTS } from './derive.mjs'

export const FILE = 'svobodens-playground.html'
/** Where the theme's style sheet goes in the theme script: a JS string, valid even before it's filled in. */
export const CSS_SLOT = '/*PG:CSS*/""'
/** The frames: their page, and which of its scripts run (all, or the dashboard's self-contained few). */
export const FRAMES = [
  { name: 'dash', page: 'index.html', run: ['hooks.js', 'xp.js', 'social.js', 'sfx.js', 'layout.js'] },
  { name: 'notices', page: 'messages.html', run: 'all', role: 'notices' },
  { name: 'overlay', page: 'overlay.html', run: 'all' },
]
// The app's theme script before the theme hooks (0.19.0): no refresh of the pseudo-elements on a switch.
const SCRIPT_0190 = `/* atalay-theme */(() => {
  const s = document.createElement('style');
  s.textContent = ${CSS_SLOT};
  document.documentElement.appendChild(s);
  window.__theme = (css) => { s.textContent = css; window.dispatchEvent(new Event('themechange')); };
})();`
/** The playground's own refresh for an app without one: the same trick as the hooks' (a class every ::before and
 *  ::after names, on for one forced layout), under a class of its own. */
export const OWN_REFRESH = { cls: 'pg-swap', rule: 'html.pg-swap *::before,html.pg-swap *::after{--pg-swap:1}' }

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A page's parts: <html>'s and <body>'s attributes, the head (the pack's preview block taken out, `pack`), the body's
 *  markup and its scripts in order (`{src}` or `{code}`), head scripts first. */
export function pageParts(html, pack) {
  const root = html.match(/<html\b([^>]*)>/i)
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)
  const body = html.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i)
  if (!head || !body) throw new Error('no <head> or <body>')
  const scripts = []
  const take = (_, attrs, code) => {
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']*)["']/i)
    scripts.push(src ? { src: src[1] } : { code })
    return ''
  }
  const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>[ \t]*\n?/gi
  const block = new RegExp(`<!-- ${reEscape(pack)} -->[\\s\\S]*?<!-- /${reEscape(pack)} -->`, 'g')
  return {
    htmlAttrs: root ? root[1] : '',
    head: head[1].replace(block, '').replace(SCRIPT, take),
    bodyAttrs: body[1],
    body: body[2].replace(SCRIPT, take),
    scripts,
  }
}

/** The theme script the app injects into every page at document start (ThemeStore.script in Themes.swift), as JS with
 *  CSS_SLOT where the sheet goes, and whether its __theme refreshes the pseudo-elements (the theme hooks' `theme-swap`
 *  class around a forced layout) with the rule that goes with it (ThemeStore.css's last line). Null when the Swift isn't
 *  shaped as expected. */
export function swiftTheme(swift) {
  const m = swift.match(/var script: WKUserScript \{\s*let source = """\n([\s\S]*?)\n([ \t]*)"""/)
  if (!m) return null
  const indent = m[2]
  const lines = m[1].split('\n').map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trim() === '' ? '' : null))
  if (lines.includes(null)) return null
  let js = lines.join('\n').replace('\\(Self.marker)', '/* atalay-theme */').replace('\\(Self.jsString(css))', CSS_SLOT)
  if (js.includes('\\(')) return null
  // Swift's own escapes in the literal (\\ \" \' \n \t \r \0); the JS gets what Swift hands WebKit.
  js = js.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', 0: '\0' })[c] ?? c)
  if (!/window\.__theme\s*=/.test(js) || !js.includes(CSS_SLOT)) return null
  const rule = (swift.match(/"(html\.([\w-]+) \*::before,html\.\2 \*::after\{[^"]*\})"/) || [])[1] || null
  const cls = rule && rule.match(/^html\.([\w-]+)/)[1]
  const refresh = !!rule && js.includes(`classList.add('${cls}')`) && /void [\w.]+\.offset(Height|Width)/.test(js)
  return { js, rule: refresh ? rule : null, refresh }
}

/** The CSS for a theme from its sheet without a font (themeCss with the default font), the font Settings picked and
 *  the refresh rule, in ThemeStore.css's order. The page runs this same function (its source goes in). */
export function assembleCss(base, font, rule) {
  return base + (font ? `:root:root{--font:${font};--font-sans:${font}}` : '') + (rule || '')
}

/** Codicon code points by name, from git.js's CP table (the activity bar's icons). */
export function codicons(gitJs) {
  const table = (gitJs.match(/const CP = \{([\s\S]*?)\};/) || [])[1] || ''
  const out = {}
  for (const [, a, b, hex] of table.matchAll(/(?:'([\w-]+)'|([\w]+)):\s*0x([0-9a-fA-F]+)/g)) out[a || b] = parseInt(hex, 16)
  return out
}

// At document start <html> is still empty, so the app's style ends up its first child; here the head came first.
const MOVE_STYLE =
  "{ const r = document.documentElement, s = r.lastElementChild; if (s && s.tagName === 'STYLE') r.insertBefore(s, r.firstChild); }"
const scriptTag = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`

/** One frame's document: the playground's first script and the app's theme script (its <style> moved to be <html>'s
 *  first child, where document start leaves it in the app), the page's head and the pack's sheets after it as the
 *  preview links them, the page's body and the scripts the frame runs, then the playground's last script. */
export function frameDoc({ frame, parts, theme, ownRefresh, pack, sheets, prelude, postlude }) {
  const run = parts.scripts.filter((s) => frame.run === 'all' || (s.src && frame.run.includes(s.src.split('/').pop())))
  const links = `<!-- ${pack} -->${sheets.map((s) => `<link rel="stylesheet" href="themes/${pack}/${s}">`).join('')}<!-- /${pack} -->`
  const first = prelude.replace("'__FRAME__'", JSON.stringify(frame.name)).replace("'__ROLE__'", JSON.stringify(frame.role || ''))
  return (
    `<!doctype html>\n<html${parts.htmlAttrs}>\n<head>\n` +
    scriptTag(`${first}\n${theme}\n${MOVE_STYLE}`) +
    (ownRefresh ? `\n<style id="pg-swap">${OWN_REFRESH.rule}</style>` : '') +
    `${parts.head}${links}\n</head>\n<body${parts.bodyAttrs}>${parts.body}\n` +
    run.map((s) => (s.src ? `<script src="${s.src}"></script>` : scriptTag(s.code))).join('\n') +
    `\n${scriptTag(postlude)}\n</body>\n</html>\n`
  )
}

const read = (file) => readFileSync(file, 'utf8')
const here = (file) => fileURLToPath(new URL(file, import.meta.url))
// Safe inside a <script> element: no "</script", no "<!--".
const inline = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

/** Everything the page needs, worked out before anything is written. */
export function build(target, root = fileURLToPath(new URL('..', import.meta.url))) {
  const { errors } = checkPack(root)
  if (errors.length) throw new Error(errors.join('\n'))
  const pkg = JSON.parse(read(join(root, 'package.json')))
  const entries = pkg.contributes.themes
  const checkout = resolve(target)
  const web = join(checkout, 'app/Resources/web')
  if (!existsSync(join(web, 'themes/themes.json'))) throw new Error(`${web} is not an Atalay's Terminal web folder`)

  const ours = entries.map(({ path }) => {
    const { $schema, ...theme } = JSON.parse(read(join(root, path)))
    return theme
  })
  const theirs = JSON.parse(read(join(web, 'themes/themes.json')))
  const themes = mergeThemes(theirs, ours, pkg.publisher)
  const sheets = entries.filter((e) => e.css).map((e) => e.css.slice('./themes/'.length))

  const swiftFile = join(checkout, 'app/Sources/AtalayTerminal/Themes.swift')
  const swift = existsSync(swiftFile) ? swiftTheme(read(swiftFile)) : null
  const theme = swift ? swift.js : SCRIPT_0190
  const refresh = swift && swift.refresh ? { mode: 'app', rule: swift.rule } : { mode: 'playground', rule: null, cls: OWN_REFRESH.cls }

  const prelude = read(here('./playground/frame.js'))
  const postlude = read(here('./playground/frame-end.js'))
  const frames = {}
  for (const frame of FRAMES) {
    const parts = pageParts(read(join(web, frame.page)), pkg.name)
    frames[frame.name] = frameDoc({ frame, parts, theme, ownRefresh: refresh.mode === 'playground', pack: pkg.name, sheets, prelude, postlude })
  }
  const gitJs = join(web, 'git.js')
  const data = {
    generated: new Date().toISOString(),
    checkout,
    pack: { name: pkg.name, label: pkg.displayName, publisher: pkg.publisher, ids: ours.map((t) => t.id) },
    themes: themes.map((t) => ({
      id: t.id,
      name: t.name,
      glow: t.glow === true,
      base: themeCss(t, themes[0], { uiFont: 'mono', refresh: false }),
      tokens: tokensOf(t),
    })),
    fonts: UI_FONTS,
    refresh,
    swiftScript: !!swift,
    hooks: existsSync(join(web, 'hooks.js')),
    codicons: existsSync(gitJs) ? codicons(read(gitJs)) : {},
    cssSlot: CSS_SLOT,
    frames,
  }
  const page = read(here('./playground/page.html'))
    .replace('/*PG:STYLE*/', () => read(here('./playground/page.css')))
    .replace('/*PG:DATA*/', () => inline(data))
    .replace(
      '/*PG:SCRIPT*/',
      () =>
        `window.PG = { assembleCss: ${assembleCss.toString()} };\n` +
        ['bridge.js', 'mocks.js', 'page.js'].map((f) => read(here(`./playground/${f}`))).join('\n'),
    )
  return { web, page, sheets, pack: pkg.name, root, summary: { themes: themes.length, refresh: refresh.mode, hooks: data.hooks } }
}

function main(target) {
  const { web, page, sheets, pack, root, summary } = build(target)
  // The pack's sheets, fonts and sounds where the frames find them, as `npm run preview` puts them (copied over, nothing
  // removed).
  const folder = join(web, 'themes', pack)
  mkdirSync(folder, { recursive: true })
  copyPack(root, folder, sheets)
  const file = join(web, FILE)
  writeFileSync(file, page)
  const quoted = `'${file.replace(/'/g, `'\\''`)}'`
  return [
    `${FILE}: ${summary.themes} themes, pseudo-element refresh from ${summary.refresh === 'app' ? "the app's __theme" : 'the playground'}, ` +
      `${summary.hooks ? 'theme hooks from hooks.js' : 'no hooks.js in this checkout'}; ${sheets.length} sheets and the sounds in web/themes/${pack}/`,
    `open it in Safari:\n  open -a Safari ${quoted}`,
  ].join('\n')
}

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) {
    console.error('usage: npm run playground -- <atalay-terminal checkout>')
    process.exit(2)
  }
  try {
    console.log(main(process.argv[2]))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
