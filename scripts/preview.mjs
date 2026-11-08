#!/usr/bin/env node
// Until the app has a marketplace: puts the pack into an Atalay's Terminal source checkout, as the app carries its own
// MUR47 theme, so a dev build there (app/dev.sh) shows it:
//   - the themes, after the app's own in web/themes/themes.json (read once at launch: restart the app after a change);
//   - their style sheets and fonts in web/themes/<pack name>/, linked from the pages that load the app's theme sheets
//     (⌘R reloads them).
// Run again freely: the pack's previous themes, files and links are replaced, never added twice.
// Usage: npm run preview -- <atalay-terminal checkout>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from './check.mjs'

const PAGES = ['index.html', 'messages.html', 'overlay.html']

const root = fileURLToPath(new URL('..', import.meta.url))
if (!process.argv[2]) {
  console.error('usage: npm run preview -- <atalay-terminal checkout>')
  process.exit(2)
}
const { errors } = checkPack(root)
if (errors.length) {
  for (const e of errors) console.error(e)
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const entries = pkg.contributes.themes
const web = join(resolve(process.argv[2]), 'app/Resources/web')

const ours = entries.map(({ path }) => {
  const { $schema, ...theme } = JSON.parse(readFileSync(join(root, path), 'utf8'))
  return theme
})
const themesFile = join(web, 'themes/themes.json')
const theirs = JSON.parse(readFileSync(themesFile, 'utf8')).filter((t) => !t.id.startsWith(`${pkg.publisher}-`))
writeFileSync(themesFile, `${JSON.stringify([...theirs, ...ours], null, 1)}\n`)

// The folder is this script's own output, so it is replaced whole and nothing renamed is left behind.
const folder = join(web, 'themes', pkg.name)
rmSync(folder, { recursive: true, force: true })
mkdirSync(folder, { recursive: true })
const sheets = entries.filter((e) => e.css).map((e) => e.css.slice('./themes/'.length))
for (const sheet of sheets) cpSync(join(root, 'themes', sheet), join(folder, sheet))
cpSync(join(root, 'themes/fonts'), join(folder, 'fonts'), { recursive: true })

const begin = `<!-- ${pkg.name} -->`
const end = `<!-- /${pkg.name} -->`
const block = `${begin}${sheets.map((s) => `<link rel="stylesheet" href="themes/${pkg.name}/${s}">`).join('')}${end}`
for (const page of PAGES) {
  const file = join(web, page)
  let html = readFileSync(file, 'utf8')
  const at = html.indexOf(begin)
  if (at !== -1) html = html.slice(0, at) + html.slice(html.indexOf(end, at) + end.length)
  writeFileSync(file, html.replace('</head>', `${block}</head>`))
}
console.log(`${ours.length} themes after the app's ${theirs.length}, ${sheets.length} style sheets linked in ${PAGES.join(', ')}`)
