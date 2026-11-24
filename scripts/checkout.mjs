// Where an Orbiterm source checkout keeps what the preview and the playground read. The Mac app moved from app/ to mac/
// in 0.23.0 (the Windows app is windows/); a checkout from before, Atalay's Terminal 0.19 among them, still has app/.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const LAYOUTS = ['mac', 'app']
const THEMES = 'Resources/web/themes/themes.json'

/** The checkout's web folder and its Themes.swift (which may be missing), from mac/ or else app/: the first whose web
 *  folder has the themes file. Throws when neither has. */
export function checkoutFolders(target) {
  const root = resolve(target)
  const dir = LAYOUTS.find((d) => existsSync(join(root, d, THEMES)))
  if (!dir) throw new Error(`${root} is not an Orbiterm checkout: no ${LAYOUTS.map((d) => `${d}/${THEMES}`).join(' or ')}`)
  return { web: join(root, dir, 'Resources/web'), swift: join(root, dir, 'Sources/AtalayTerminal/Themes.swift') }
}
