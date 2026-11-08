#!/usr/bin/env node
// The pack's gate before it ships: package.json, every theme it lists, and theme files nothing lists.
// The app takes a colour it can't read as another one without a word (black, white, the text colour, or magenta in its
// native views), and one mistyped value in its themes file drops every theme, so both are caught here.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The theme format's rules come from its schema, so the two can't disagree.
const schema = JSON.parse(readFileSync(new URL('../schemas/theme.schema.json', import.meta.url), 'utf8'))
const DEFS = Object.fromEntries(Object.entries(schema.definitions).map(([name, d]) => [`#/definitions/${name}`, new RegExp(d.pattern)]))
const FORM = { '#/definitions/color': '#rrggbb', '#/definitions/triplet': '"r, g, b"' }
const COLOR = DEFS['#/definitions/color']
const SLUG = new RegExp(schema.properties.id.pattern)
const TOKEN = new RegExp(schema.properties.ui.propertyNames.pattern)
const UI_RULES = [
  ...Object.entries(schema.properties.ui.properties).map(([key, s]) => ({ applies: (k) => k === key, ref: s.$ref })),
  ...Object.entries(schema.properties.ui.patternProperties).map(([p, s]) => ({ applies: (k) => new RegExp(p).test(k), ref: s.$ref })),
]
const SEMVER = /^\d+\.\d+\.\d+$/
const PATH = /^\.\/themes\/[^/]+\.json$/
const CSS_PATH = /^\.\/themes\/[^/]+\.css$/
const FONT = /\.(ttf|otf|woff2?)$/i
// url("…"), url('…') or url(…); a quoted data URI may hold ")" of its own.
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/g
const COLORS = ['bg', 'fg', 'cursor', 'selection', 'accent']
const REQUIRED = schema.required
const KNOWN = new Set(Object.keys(schema.properties))

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
const show = (v) => {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return '(unprintable)'
  }
}

/** What is wrong with one theme file, in the app's ThemeSpec format; [] when nothing is. */
export function checkTheme(theme) {
  if (!isObject(theme)) return ['not a JSON object']
  const errors = []
  for (const key of REQUIRED) if (!(key in theme)) errors.push(`missing "${key}"`)
  for (const key of Object.keys(theme)) if (!KNOWN.has(key)) errors.push(`unknown key "${key}"`)
  if ('$schema' in theme && typeof theme.$schema !== 'string') errors.push('$schema is not a string')
  if ('id' in theme && !(typeof theme.id === 'string' && SLUG.test(theme.id))) errors.push(`id ${show(theme.id)} is not lowercase-with-dashes`)
  if ('name' in theme && !nonEmpty(theme.name)) errors.push('name is empty')
  for (const key of COLORS) {
    if (key in theme && !(typeof theme[key] === 'string' && COLOR.test(theme[key]))) errors.push(`${key} ${show(theme[key])} is not #rrggbb`)
  }
  if ('ansi' in theme) {
    if (!Array.isArray(theme.ansi)) errors.push('ansi is not a list')
    else {
      if (theme.ansi.length !== 16) errors.push(`ansi has ${theme.ansi.length} colours, needs 16`)
      theme.ansi.forEach((c, i) => {
        if (!(typeof c === 'string' && COLOR.test(c))) errors.push(`ansi[${i}] ${show(c)} is not #rrggbb`)
      })
    }
  }
  if ('ui' in theme) {
    if (!isObject(theme.ui)) errors.push('ui is not an object')
    else {
      for (const [key, value] of Object.entries(theme.ui)) {
        if (!TOKEN.test(key)) errors.push(`ui key "${key}" is not a --token`)
        if (typeof value !== 'string') {
          errors.push(`ui "${key}" is not a string`)
          continue
        }
        for (const rule of UI_RULES) {
          if (rule.applies(key) && !DEFS[rule.ref].test(value)) errors.push(`ui "${key}" ${show(value)} is not ${FORM[rule.ref]}`)
        }
      }
    }
  }
  if ('glow' in theme && typeof theme.glow !== 'boolean') errors.push('glow is not true or false')
  return errors
}

/** What is wrong with package.json's own fields and its list of themes; [] when nothing is. */
export function checkManifest(pkg) {
  if (!isObject(pkg)) return ['not a JSON object']
  const errors = []
  if (!(typeof pkg.name === 'string' && SLUG.test(pkg.name))) errors.push('name is not lowercase-with-dashes')
  if (!nonEmpty(pkg.displayName)) errors.push('displayName is empty')
  if (!(typeof pkg.version === 'string' && SEMVER.test(pkg.version))) errors.push('version is not x.y.z')
  if (!(typeof pkg.publisher === 'string' && SLUG.test(pkg.publisher))) errors.push('publisher is not lowercase-with-dashes')
  if (!nonEmpty(pkg.engines?.['atalay-terminal'])) errors.push('engines["atalay-terminal"] is missing')
  if (!Array.isArray(pkg.categories) || !pkg.categories.includes('Themes')) errors.push('categories lacks "Themes"')
  const list = pkg.contributes?.themes
  if (!Array.isArray(list)) return [...errors, 'contributes.themes is not a list']
  // The app keeps every theme by its id alone, so the publisher's prefix keeps them apart from the app's own and others'.
  const prefix = `${pkg.publisher}-`
  const seen = new Set()
  list.forEach((entry, i) => {
    const at = `contributes.themes[${i}]`
    if (!isObject(entry)) {
      errors.push(`${at} is not an object`)
      return
    }
    if (!(typeof entry.id === 'string' && SLUG.test(entry.id) && entry.id.startsWith(prefix))) {
      errors.push(`${at}.id ${show(entry.id)} does not start with "${prefix}"`)
    } else if (seen.has(entry.id)) {
      errors.push(`${at}.id "${entry.id}" is listed twice`)
    }
    seen.add(entry.id)
    if (!nonEmpty(entry.label)) errors.push(`${at}.label is empty`)
    if (entry.uiTheme !== 'vs-dark') errors.push(`${at}.uiTheme is not "vs-dark" (the app has dark themes only)`)
    if (!(typeof entry.path === 'string' && PATH.test(entry.path))) errors.push(`${at}.path is not ./themes/<file>.json`)
    if ('css' in entry && !(typeof entry.css === 'string' && CSS_PATH.test(entry.css))) errors.push(`${at}.css is not ./themes/<file>.css`)
  })
  return errors
}

/** A style sheet's top level: each block's prelude and body, and statements outside blocks. Comments go; strings and
 *  unquoted url(…) are skipped whole, so the braces and "/*" a data URI may hold count for nothing. */
export function sheetBlocks(text) {
  const blocks = []
  let depth = 0, prelude = '', body = '', i = 0
  const skipString = () => {
    const quote = text[i]
    let j = i + 1
    while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
    const s = text.slice(i, j + 1)
    i = j + 1
    return s
  }
  while (i < text.length) {
    let piece
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    } else if (text[i] === '"' || text[i] === "'") {
      piece = skipString()
    } else if (/^url\(\s*[^\s'"]/i.test(text.slice(i, i + 6))) {
      const end = text.indexOf(')', i)
      piece = text.slice(i, end === -1 ? text.length : end + 1)
      i += piece.length
    } else {
      piece = text[i++]
      if (piece === '{' && depth++ === 0) continue
      if (piece === '}' && --depth === 0) {
        blocks.push({ prelude: prelude.trim().replace(/\s+/g, ' '), body: body.trim() })
        prelude = body = ''
        continue
      }
    }
    if (depth === 0) prelude += piece
    else body += piece
  }
  if (prelude.trim()) blocks.push({ prelude: prelude.trim().replace(/\s+/g, ' '), body: null })
  return blocks
}

const squash = (s) => (s ?? '').replace(/\s+/g, '').replace(/;$/, '')

/** The rules in a block (through any @media/@supports inside it) whose selectors reach ::before or ::after. */
function pseudoRules(body) {
  const found = []
  for (const { prelude, body: inner } of sheetBlocks(body)) {
    if (inner === null || /^@keyframes\b/i.test(prelude)) continue
    if (prelude.startsWith('@')) found.push(...pseudoRules(inner))
    else if (/::?(before|after)\b/i.test(prelude)) found.push(prelude)
  }
  return found
}

/** What is outside the theme's gate in its sheet: every top-level block must apply only while the theme is chosen, or be
 *  one of the few that can't affect another theme. The gate is @container [svb-root] style(--theme-id: <id>); svb-root
 *  (named on <html>) is what pseudo-elements need, since WebKit evaluates an unnamed query on a pseudo-element against
 *  its element's old style and leaves it on screen after the theme changes. */
export function checkSheet(text, id) {
  const errors = []
  for (const { prelude, body } of sheetBlocks(text)) {
    const gate = /^@container (svb-root )?style\(--theme-id: ?([a-z0-9-]+)\)$/i.exec(prelude)
    if (gate) {
      if (gate[2] !== id) errors.push(`gated on "${gate[2]}", not on this theme`)
      if (!gate[1]) {
        for (const selector of pseudoRules(body ?? '')) errors.push(`"${selector.slice(0, 60)}" needs the svb-root gate (a pseudo-element)`)
      }
      continue
    }
    if (body === null) {
      errors.push(`"${prelude}" is outside the theme's gate`)
      continue
    }
    // A condition around gated rules keeps them gated: what's inside answers to the same rules.
    if (/^@(media|supports)\b/i.test(prelude)) {
      errors.push(...checkSheet(body, id))
      continue
    }
    const allowed =
      prelude === '@font-face'
      || /^@keyframes svb-[a-z0-9-]+$/i.test(prelude)
      || (prelude === '#mapwrap' && squash(body) === '--theme-id:none')
      || (prelude === 'html' && squash(body) === 'container-name:svb-root')
      // the theme's own card on the theme screen, shown while another theme is chosen
      || (!prelude.startsWith('@') && prelude.split(',').every((selector) => selector.includes(id)))
    if (!allowed) errors.push(`"${prelude.slice(0, 60)}" is outside the theme's gate`)
  }
  return errors
}

/** The files a style sheet points at with url(), as written (data: URIs and #fragments left out, comments ignored). */
export function cssRefs(text) {
  const live = sheetBlocks(text).map((b) => `${b.prelude}{${b.body ?? ''}}`).join('')
  return [...live.matchAll(URL_REF)].map((m) => m[1] ?? m[2] ?? m[3]).filter((ref) => ref && !ref.startsWith('data:') && !ref.startsWith('#'))
}

/** What is wrong with a theme's style sheet in the pack: its gate, and what it points at, which must sit beside it. */
function checkCss(root, entry, theme, used) {
  const file = entry.css.slice(2)
  let text
  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch (error) {
    return [`${file}: ${error.code === 'ENOENT' ? 'listed in package.json but missing' : error.message}`]
  }
  const errors = checkSheet(text, entry.id).map((e) => `${file}: ${e}`)
  if (theme?.ui?.['--theme-id'] !== entry.id) errors.push(`${file}: never applies, ${entry.path.slice(2)} has no ui "--theme-id": "${entry.id}"`)
  for (const ref of cssRefs(text)) {
    // The app loads its pages from file://, so only a path relative to the sheet reaches the pack's files.
    const target = posix.normalize(posix.join('themes', ref))
    if (ref.startsWith('/') || ref.includes(':')) errors.push(`${file}: url("${ref}") is not relative to the sheet`)
    else if (!target.startsWith('themes/')) errors.push(`${file}: url("${ref}") leaves themes/`)
    else if (!existsSync(join(root, target))) errors.push(`${file}: url("${ref}") is missing`)
    else used.add(target)
  }
  return errors
}

/** The pack under `root`: package.json, every theme it lists (its file there and agreeing with its entry) and theme
 *  files nothing lists. Each error starts with its file. */
export function checkPack(root) {
  const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'))
  let pkg
  try {
    pkg = read('package.json')
  } catch (error) {
    return { errors: [`package.json: ${error.message}`], count: 0 }
  }
  const errors = checkManifest(pkg).map((e) => `package.json: ${e}`)
  const list = Array.isArray(pkg?.contributes?.themes) ? pkg.contributes.themes : []
  const listed = new Set()
  const used = new Set()
  for (const entry of list) {
    if (!isObject(entry) || !(typeof entry.path === 'string' && PATH.test(entry.path))) continue
    const file = entry.path.slice(2)
    listed.add(file)
    const hasCss = typeof entry.css === 'string' && CSS_PATH.test(entry.css)
    if (hasCss) listed.add(entry.css.slice(2))
    let theme
    try {
      theme = read(file)
    } catch (error) {
      errors.push(`${file}: ${error.code === 'ENOENT' ? 'listed in package.json but missing' : error.message}`)
      // Its sheet still counts the fonts it loads; its own errors wait until the theme file reads.
      if (hasCss) checkCss(root, entry, undefined, used)
      continue
    }
    errors.push(...checkTheme(theme).map((e) => `${file}: ${e}`))
    if (theme?.id !== entry.id) errors.push(`${file}: id ${show(theme?.id)} is not package.json's ${show(entry.id)}`)
    if (theme?.name !== entry.label) errors.push(`${file}: name ${show(theme?.name)} is not package.json's label ${show(entry.label)}`)
    if (hasCss) errors.push(...checkCss(root, entry, theme, used))
    // A theme naming another one's id would wear that theme's sheet.
    const named = isObject(theme?.ui) ? theme.ui['--theme-id'] : undefined
    if (named !== undefined && named !== entry.id) errors.push(`${file}: ui "--theme-id" ${show(named)} is not its own id ${show(entry.id)}`)
  }
  // null: not there to scan (reported unless simply absent).
  const files = (dir, keep) => {
    try {
      return readdirSync(join(root, dir)).filter(keep).map((f) => `${dir}/${f}`)
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push(`${dir}: ${error.code === 'ENOTDIR' ? 'not a folder' : error.message}`)
      return null
    }
  }
  const sheets = files('themes', (f) => f.endsWith('.json') || f.endsWith('.css'))
  for (const f of sheets ?? []) if (!listed.has(f)) errors.push(`${f}: not listed in package.json`)
  // A font no theme's sheet loads is only weight in every install.
  const fonts = sheets === null ? [] : files('themes/fonts', (f) => FONT.test(f))
  for (const f of fonts ?? []) if (!used.has(f)) errors.push(`${f}: no theme's CSS uses it`)
  return { errors, count: list.length }
}

// Run directly (not imported by the tests): compared as real paths, so a symlinked path to the script still runs it.
const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url))
  const { errors, count } = checkPack(root)
  for (const e of errors) console.error(e)
  if (errors.length) process.exit(1)
  console.log(count ? `ok: ${count} theme${count === 1 ? '' : 's'}` : 'ok: no themes yet')
}
