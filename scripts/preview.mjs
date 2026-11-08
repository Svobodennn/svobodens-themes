#!/usr/bin/env node
// Until the app has a marketplace: puts the pack into an Atalay's Terminal source checkout, as the app carries its own
// MUR47 theme, so a dev build there (app/dev.sh) shows it:
//   - the themes, after the app's own in web/themes/themes.json (read once at launch: restart the app after a change);
//   - their style sheets and fonts in web/themes/<pack name>/, linked from the pages that load the app's theme sheets
//     (⌘R reloads them).
// It edits tracked files of that checkout (themes.json and the three pages); `--undo` takes out only what it put there
// and leaves other changes in that folder alone. Run again freely: the pack's previous themes, files and links are
// replaced, never added twice. Either way everything is worked out before anything is written, so a page it can't patch
// leaves the checkout as it was.
// Usage: npm run preview -- <atalay-terminal checkout> [--undo]
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from './check.mjs'

export const PAGES = ['index.html', 'messages.html', 'overlay.html']

const markers = (name) => [`<!-- ${name} -->`, `<!-- /${name} -->`]

/** The page without the pack's marked block; the page as it was when it has none. Throws on a block that was started
 *  and never ended, where cutting to a missing end would take the rest of the page with it. */
export function unpatchPage(html, name) {
  const [begin, end] = markers(name)
  const at = html.indexOf(begin)
  if (at === -1) return html
  const stop = html.indexOf(end, at)
  if (stop === -1) throw new Error(`"${begin}" has no "${end}" after it`)
  return html.slice(0, at) + html.slice(stop + end.length)
}

/** The page with the pack's marked <link> block in its head, replacing any earlier one. Throws on a page it can't
 *  patch safely: a block that was started and never ended, or no </head>. */
export function patchPage(html, name, sheets) {
  const [begin, end] = markers(name)
  const out = unpatchPage(html, name)
  const head = out.search(/<\/head>/i)
  if (head === -1) throw new Error('no </head>')
  const block = `${begin}${sheets.map((s) => `<link rel="stylesheet" href="themes/${name}/${s}">`).join('')}${end}`
  return out.slice(0, head) + block + out.slice(head)
}

/** A JSON value spaced as the app's themes file is: Python's json.dumps, ", " and ": ". */
const dumps = (value) => {
  if (Array.isArray(value)) return `[${value.map(dumps).join(', ')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${dumps(v)}`).join(', ')}}`
  return JSON.stringify(value)
}

/** The themes file in the app's own layout, one theme a line, so the pack's lines are the only ones it changes. */
export const formatThemes = (themes) => `[\n${themes.map((theme) => `  ${dumps(theme)}`).join(',\n')}\n]\n`

/** The app's themes with the pack's after them (the pack's earlier copies dropped). */
export function mergeThemes(theirs, ours, publisher) {
  return [...theirs.filter((t) => !t.id.startsWith(`${publisher}-`)), ...ours]
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The checkout's web folder, or why it isn't one. */
function webFolder(target) {
  const web = join(resolve(target), 'app/Resources/web')
  if (!existsSync(join(web, 'themes/themes.json'))) throw new Error(`${web} is not an Atalay's Terminal web folder`)
  return web
}

/** Each page, read and changed by `change`, before anything is written. */
const changedPages = (web, change) =>
  PAGES.map((page) => {
    const file = join(web, page)
    try {
      const html = readFileSync(file, 'utf8')
      return [file, html, change(html)]
    } catch (error) {
      throw new Error(`${page}: ${error.message}`)
    }
  })

/** Takes out what main() put into the checkout: the pack's themes, its marked blocks and its folder. Only the pack's
 *  name and publisher are read, so it works on a pack that doesn't pass its check. */
function undo(target) {
  const { name, publisher } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  // The folder it removes is named after the pack, so a name that isn't a plain slug could reach outside it.
  if (!SLUG.test(name ?? '') || !SLUG.test(publisher ?? '')) throw new Error('package.json: name or publisher is not lowercase-with-dashes')
  const web = webFolder(target)
  const themesFile = join(web, 'themes/themes.json')
  const theirs = JSON.parse(readFileSync(themesFile, 'utf8'))
  const themes = mergeThemes(theirs, [], publisher)
  const pages = changedPages(web, (html) => unpatchPage(html, name))

  if (themes.length !== theirs.length) writeFileSync(themesFile, formatThemes(themes))
  rmSync(join(web, 'themes', name), { recursive: true, force: true })
  for (const [file, before, after] of pages) if (after !== before) writeFileSync(file, after)
  return `${theirs.length - themes.length} themes and the links in ${PAGES.join(', ')} taken out, themes/${name} removed`
}

function main(target) {
  const { errors } = checkPack(ROOT)
  if (errors.length) throw new Error(errors.join('\n'))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const entries = pkg.contributes.themes
  const web = webFolder(target)

  const ours = entries.map(({ path }) => {
    const { $schema, ...theme } = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
    return theme
  })
  const themesFile = join(web, 'themes/themes.json')
  const theirs = JSON.parse(readFileSync(themesFile, 'utf8'))
  const themes = mergeThemes(theirs, ours, pkg.publisher)
  const sheets = entries.filter((e) => e.css).map((e) => e.css.slice('./themes/'.length))
  const pages = changedPages(web, (html) => patchPage(html, pkg.name, sheets))

  writeFileSync(themesFile, formatThemes(themes))
  // The folder is this script's own output, so it is replaced whole and nothing renamed is left behind.
  const folder = join(web, 'themes', pkg.name)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  for (const sheet of sheets) cpSync(join(ROOT, 'themes', sheet), join(folder, sheet))
  cpSync(join(ROOT, 'themes/fonts'), join(folder, 'fonts'), { recursive: true })
  for (const [file, , html] of pages) writeFileSync(file, html)
  return `${ours.length} themes after the app's ${themes.length - ours.length}, ${sheets.length} style sheets linked in ${PAGES.join(', ')}`
}

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const targets = args.filter((a) => a !== '--undo')
  if (targets.length !== 1 || targets[0].startsWith('--')) {
    console.error('usage: npm run preview -- <atalay-terminal checkout> [--undo]')
    process.exit(2)
  }
  try {
    console.log(args.includes('--undo') ? undo(targets[0]) : main(targets[0]))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
