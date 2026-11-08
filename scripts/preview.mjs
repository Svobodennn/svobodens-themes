#!/usr/bin/env node
// Until the app has a marketplace: puts the pack into an Atalay's Terminal source checkout, as the app carries its own
// MUR47 theme, so a dev build there (app/dev.sh) shows it:
//   - the themes, after the app's own in web/themes/themes.json (read once at launch: restart the app after a change);
//   - their style sheets and fonts in web/themes/<pack name>/, linked from the pages that load the app's theme sheets
//     (⌘R reloads them).
// It edits tracked files of that checkout (themes.json and the three pages); `git checkout -- app/Resources/web` there
// undoes it. Run again freely: the pack's previous themes, files and links are replaced, never added twice. Everything
// is worked out before anything is written, so a page it can't patch leaves the checkout as it was.
// Usage: npm run preview -- <atalay-terminal checkout>
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from './check.mjs'

export const PAGES = ['index.html', 'messages.html', 'overlay.html']

/** The page with the pack's marked <link> block in its head, replacing any earlier one. Throws on a page it can't
 *  patch safely: a block that was started and never ended, or no </head>. */
export function patchPage(html, name, sheets) {
  const begin = `<!-- ${name} -->`
  const end = `<!-- /${name} -->`
  let out = html
  const at = out.indexOf(begin)
  if (at !== -1) {
    const stop = out.indexOf(end, at)
    if (stop === -1) throw new Error(`"${begin}" has no "${end}" after it`)
    out = out.slice(0, at) + out.slice(stop + end.length)
  }
  const head = out.search(/<\/head>/i)
  if (head === -1) throw new Error('no </head>')
  const block = `${begin}${sheets.map((s) => `<link rel="stylesheet" href="themes/${name}/${s}">`).join('')}${end}`
  return out.slice(0, head) + block + out.slice(head)
}

/** The app's themes with the pack's after them (the pack's earlier copies dropped). */
export function mergeThemes(theirs, ours, publisher) {
  return [...theirs.filter((t) => !t.id.startsWith(`${publisher}-`)), ...ours]
}

function main(target) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { errors } = checkPack(root)
  if (errors.length) throw new Error(errors.join('\n'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const entries = pkg.contributes.themes
  const web = join(resolve(target), 'app/Resources/web')
  if (!existsSync(join(web, 'themes/themes.json'))) throw new Error(`${web} is not an Atalay's Terminal web folder`)

  const ours = entries.map(({ path }) => {
    const { $schema, ...theme } = JSON.parse(readFileSync(join(root, path), 'utf8'))
    return theme
  })
  const themesFile = join(web, 'themes/themes.json')
  const theirs = JSON.parse(readFileSync(themesFile, 'utf8'))
  const themes = mergeThemes(theirs, ours, pkg.publisher)
  const sheets = entries.filter((e) => e.css).map((e) => e.css.slice('./themes/'.length))
  const pages = PAGES.map((page) => {
    const file = join(web, page)
    try {
      return [file, patchPage(readFileSync(file, 'utf8'), pkg.name, sheets)]
    } catch (error) {
      throw new Error(`${page}: ${error.message}`)
    }
  })

  writeFileSync(themesFile, `${JSON.stringify(themes, null, 1)}\n`)
  // The folder is this script's own output, so it is replaced whole and nothing renamed is left behind.
  const folder = join(web, 'themes', pkg.name)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  for (const sheet of sheets) cpSync(join(root, 'themes', sheet), join(folder, sheet))
  cpSync(join(root, 'themes/fonts'), join(folder, 'fonts'), { recursive: true })
  for (const [file, html] of pages) writeFileSync(file, html)
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
  if (!process.argv[2]) {
    console.error('usage: npm run preview -- <atalay-terminal checkout>')
    process.exit(2)
  }
  try {
    console.log(main(process.argv[2]))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
