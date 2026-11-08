#!/usr/bin/env node
// The pack's gate before it ships: package.json, every theme it lists, and theme files nothing lists.
// The app takes a colour it can't read as another one without a word (black, white, the text colour, or magenta in its
// native views), and one mistyped value in its themes file drops every theme, so both are caught here.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bare, pieces, scan, splitList, unescape } from './css-scan.mjs'
import { MAX_SOUND_BYTES, SOUND_NAMES } from './sfx/names.mjs'
import { wavErrors } from './sfx/wav.mjs'

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

/** A style sheet's top level: each block's prelude and its body as written, and statements, with a null body. */
export const sheetBlocks = (text) => scan(text).items

const GATE = /^@container (svb-root )?style\( ?--theme-id ?: ?([a-z0-9-]+) ?\)$/i
// Each defines a name or an order for the whole page, which no condition around it can keep to one theme.
const GLOBAL = /^@(?:property|counter-style|layer|font-feature-values|font-palette-values|import)(?![\w-])/i
const KEYFRAMES = /^@(?:-webkit-)?keyframes(?![\w-]) ?(.*)$/i
const FONT_FACE = /^@font-face$/i
const GROUP = /^@(?:media|supports|container|starting-style)(?![\w-])/i
const PSEUDO = /::|:(?:before|after|first-letter|first-line)(?![\w-])/i
const SVB_FAMILY = /^(["'])Svb [^"'\\]+\1$/
const short = (s) => s.slice(0, 60)
const outside = (prelude) => `"${short(prelude)}" is outside the theme's gate`
const hasPseudo = (selector) => PSEUDO.test(bare(selector))
const holdsRules = (body) => scan(body).items.some((item) => item.body !== null)
const plain = (body) => pieces(body).list.filter((p) => p.type !== 'comment').map((p) => p.text).join('').replace(/\s+/g, '').replace(/;$/, '')

/** A body's declarations, each name with its escapes resolved (so `font-famil\79` is font-family). */
const declarations = (body) =>
  scan(body).items.filter((item) => item.body === null && item.prelude.includes(':')).map(({ prelude }) => ({
    name: unescape(prelude.slice(0, prelude.indexOf(':'))).trim().toLowerCase(),
    value: prelude.slice(prelude.indexOf(':') + 1).trim(),
  }))

/** Whether a character from `chars` sits outside every () and [] of a bare selector. */
function atTopLevel(text, chars) {
  let depth = 0
  for (const c of text) {
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && chars.includes(c)) return true
  }
  return false
}

/** Whether every selector is the theme's own card on the theme screen or something in it, which shows while another
 *  theme is chosen: it starts with the card and only goes down from there (no sibling, no :has()). */
function ownCard(prelude, id) {
  const card = `.th-card[data-id="${id}"]`
  return splitList(prelude).every((selector) => {
    // <html> is the root, so a class on it only narrows the selector (the window being behind another one, say).
    const s = selector.replace(/^html(?:\.[\w-]+)*\s+/, '')
    if (!s.startsWith(card)) return false
    // The card's closing "] ends the id, so a longer id that starts with this one is another theme's card.
    const rest = bare(s.slice(card.length))
    return !/:has\(/i.test(rest) && !atTopLevel(rest, '~+|')
  })
}

/** Keyframes and font faces are global wherever they sit, so their names must stay out of the app's and other packs'. */
function checkAtRule(prelude, body, report, group) {
  const keyframes = KEYFRAMES.exec(prelude)
  if (GLOBAL.test(prelude)) report.errors.push(`"${short(prelude)}" is not allowed: it reaches every theme, gated or not`)
  else if (keyframes) {
    const name = /^(["']).*\1$/.test(keyframes[1]) ? keyframes[1].slice(1, -1) : unescape(keyframes[1])
    if (/^svb-[\w-]+$/.test(name)) report.keyframes.push(name)
    else report.errors.push(`"${short(prelude)}" is not named svb-…, and keyframes reach every theme`)
  } else if (FONT_FACE.test(prelude)) {
    const families = declarations(body ?? '').filter((d) => d.name === 'font-family')
    if (!families.length || !families.every((d) => SVB_FAMILY.test(d.value))) {
      report.errors.push('"@font-face" needs font-family: "Svb …" (a font face reaches every theme)')
    }
  } else if (group && GROUP.test(prelude) && body !== null) group()
  else report.errors.push(group ? `"${short(prelude)}" is not allowed in a gate` : outside(prelude))
}

/** The rules a gate holds, at any depth. Under the unnamed gate WebKit checks a pseudo-element against its element's
 *  old style and leaves it on screen after the theme changes; the svb-root gate ignores the orbit map's reset, so it
 *  holds pseudo-elements only. */
function checkGated(text, named, report, inPseudo = false) {
  for (const { prelude, body } of scan(text).items) {
    if (prelude.startsWith('@')) {
      checkAtRule(prelude, body, report, () => {
        if (named && /^@container(?![\w-])/i.test(prelude) && !/^@container svb-root /i.test(prelude)) {
          report.errors.push(`"${short(prelude)}" inside the svb-root gate needs the svb-root name too`)
        }
        checkGated(body, named, report, inPseudo)
      })
    } else if (body !== null) {
      const pseudo = inPseudo || splitList(prelude).every(hasPseudo)
      if (!named && hasPseudo(prelude)) report.errors.push(`"${short(prelude)}" needs the svb-root gate (a pseudo-element)`)
      if (named && !pseudo && declarations(body).length) {
        report.errors.push(`"${short(prelude)}" is an element rule: the svb-root gate reaches into the orbit map, so it goes in the unnamed gate`)
      }
      checkGated(body, named, report, pseudo)
    }
  }
}

/** A sheet's (or a top-level @media's) items: each must be gated on the theme, or one of the few that can't touch another
 *  theme. */
function checkTop(text, id, report, atStart) {
  const { items, problems } = scan(text)
  report.errors.push(...problems)
  items.forEach(({ prelude, body }, i) => {
    const gate = GATE.exec(prelude)
    if (gate && body !== null) {
      if (gate[2] !== id) report.errors.push(`gated on "${gate[2]}", not on this theme`)
      checkGated(body, Boolean(gate[1]), report)
    } else if (GLOBAL.test(prelude) || KEYFRAMES.test(prelude) || FONT_FACE.test(prelude)) checkAtRule(prelude, body, report)
    else if (atStart && i === 0 && body === null && /^@charset "[^"]*"$/.test(prelude)) return
    else if (body === null) report.errors.push(outside(prelude))
    // A condition around gated rules keeps them gated: what's inside answers to the same rules.
    else if (/^@(?:media|supports)(?![\w-])/i.test(prelude)) checkTop(body, id, report, false)
    else if ((prelude === '#mapwrap' && plain(body) === '--theme-id:none') || (prelude === 'html' && plain(body) === 'container-name:svb-root')) return
    else if (!prelude.startsWith('@') && ownCard(prelude, id)) {
      if (holdsRules(body)) report.errors.push(`"${short(prelude)}" holds nested rules (a theme's own card takes plain declarations only)`)
    } else report.errors.push(outside(prelude))
  })
}

/** What a theme's sheet sets outside its gate, and the keyframes it names (global, so checked across the pack). */
function inspectSheet(text, id) {
  const report = { errors: [], keyframes: [] }
  checkTop(text, id, report, true)
  return report
}

/** What is outside the theme's gate in its sheet: every rule must apply only while the theme is chosen, or be one of the
 *  few that can't affect another theme. The gate is @container [svb-root] style(--theme-id: <id>); svb-root (named on
 *  <html>) is what pseudo-elements need. */
export const checkSheet = (text, id) => inspectSheet(text, id).errors

/** The files a style sheet points at with url(), without ?query or #fragment (data: URIs and #fragments left out, and a
 *  url() in a comment or a string is none). */
export function cssRefs(text) {
  const list = pieces(text).list.filter((p) => p.type !== 'comment' && !(p.type === 'char' && /\s/.test(p.text)))
  const refs = list.map((p, i) => {
    if (p.type === 'url') return p.text.slice(p.text.indexOf('(') + 1).replace(/\)$/, '').trim()
    const quoted = p.type === 'ident' && p.name.toLowerCase() === 'url' && list[i + 1]?.text === '(' && list[i + 2]?.type === 'string'
    return quoted ? list[i + 2].text.slice(1, -1) : ''
  })
  return refs.filter((ref) => ref && !ref.startsWith('data:')).map((ref) => ref.replace(/[?#][^]*$/, '')).filter(Boolean)
}

/** What is wrong with a theme's style sheet in the pack: its gate, and what it points at, which must sit beside it. */
function checkCss(root, entry, theme, used, keyframes) {
  const file = entry.css.slice(2)
  let text
  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch (error) {
    return [`${file}: ${error.code === 'ENOENT' ? 'listed in package.json but missing' : error.message}`]
  }
  const sheet = inspectSheet(text, entry.id)
  const errors = sheet.errors.map((e) => `${file}: ${e}`)
  // Keyframes are global: two sheets naming the same ones would take each other's.
  for (const name of new Set(sheet.keyframes)) {
    const other = keyframes.get(name)
    if (other && other !== file) errors.push(`${file}: "@keyframes ${name}" is also in ${other}`)
    else keyframes.set(name, file)
  }
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

const SOUNDS = new Set(SOUND_NAMES)
// hooks.js's soundFile: the app plays only a plain path from its web folder, and no way out of it.
const SOUND_PATH = /^[\w-][\w ./-]*$/
const UP = /(^|\/)\.\.(\/|$)/

/** The pack file (themes/sfx/…) a `--sfx-<name>` value plays once installed under themes/<pack>/: '' for none, null for
 *  a value the app wouldn't play or that isn't one of the pack's own sounds. Quotes and spaces around it as the app
 *  takes them. */
function soundTarget(value, pack) {
  const v = String(value).trim().replace(/^(["'])(.*)\1$/, '$2')
  if (v === 'none') return ''
  if (!SOUND_PATH.test(v) || UP.test(v)) return null
  const path = posix.normalize(v)
  const prefix = `themes/${pack}/sfx/`
  if (!path.startsWith(prefix) || !/\.wav$/i.test(path)) return null
  return `themes/sfx/${path.slice(prefix.length)}`
}

/** A theme's sound tokens: their errors, and each pack file they play with who points at it (into `refs`). */
function checkSounds(file, ui, pack, refs) {
  const errors = []
  for (const [key, value] of Object.entries(ui)) {
    if (!key.startsWith('--sfx-')) continue
    if (!SOUNDS.has(key.slice('--sfx-'.length))) {
      errors.push(`${file}: ui "${key}" is not a sound the app plays`)
      continue
    }
    const target = typeof value === 'string' ? soundTarget(value, pack) : null
    if (target === null) errors.push(`${file}: ui "${key}" ${show(value)} is not none or a .wav under themes/${pack}/sfx/`)
    else if (target) refs.set(target, [...(refs.get(target) ?? []), `${file}: ui "${key}"`])
  }
  return errors
}

/** The sound files themes point at (there, a WAV the app plays as it is, small), and the ones none does. */
function checkSoundFiles(root, refs) {
  const errors = []
  for (const [target, by] of refs) {
    let buf
    try {
      buf = readFileSync(join(root, target))
    } catch (error) {
      if (error.code === 'ENOENT') errors.push(...by.map((who) => `${who} points at ${target}, which is missing`))
      else errors.push(`${target}: ${error.message}`)
      continue
    }
    if (buf.length > MAX_SOUND_BYTES) errors.push(`${target}: ${Math.ceil(buf.length / 1024)} KB, over the ${MAX_SOUND_BYTES / 1024} KB cap`)
    errors.push(...wavErrors(buf).map((e) => `${target}: ${e}`))
  }
  const dir = join(root, 'themes/sfx')
  let found = []
  try {
    found = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
  } catch (error) {
    // ENOTDIR from themes itself being a file is reported once, by the theme files' own scan.
    if (error.code === 'ENOTDIR' ? existsSync(dir) : error.code !== 'ENOENT') errors.push(`themes/sfx: ${error.code === 'ENOTDIR' ? 'not a folder' : error.message}`)
  }
  // Dot files (Finder's .DS_Store) are no sound.
  const files = found.map((d) => posix.join('themes/sfx', relative(dir, join(d.parentPath, d.name)).split(sep).join('/')))
  for (const f of files.filter((f) => !f.split('/').some((s) => s.startsWith('.'))).sort()) {
    if (!refs.has(f)) errors.push(`${f}: no theme uses it`)
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
  const keyframes = new Map()
  const sounds = new Map()
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
      if (hasCss) checkCss(root, entry, undefined, used, keyframes)
      continue
    }
    errors.push(...checkTheme(theme).map((e) => `${file}: ${e}`))
    if (theme?.id !== entry.id) errors.push(`${file}: id ${show(theme?.id)} is not package.json's ${show(entry.id)}`)
    if (theme?.name !== entry.label) errors.push(`${file}: name ${show(theme?.name)} is not package.json's label ${show(entry.label)}`)
    if (hasCss) errors.push(...checkCss(root, entry, theme, used, keyframes))
    // A theme naming another one's id would wear that theme's sheet.
    const named = isObject(theme?.ui) ? theme.ui['--theme-id'] : undefined
    if (named !== undefined && named !== entry.id) errors.push(`${file}: ui "--theme-id" ${show(named)} is not its own id ${show(entry.id)}`)
    if (isObject(theme?.ui)) errors.push(...checkSounds(file, theme.ui, pkg.name, sounds))
  }
  errors.push(...checkSoundFiles(root, sounds))
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
