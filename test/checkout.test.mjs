import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkoutFolders } from '../scripts/checkout.mjs'

const temp = mkdtempSync(join(tmpdir(), 'svobodens-themes-checkout-'))
after(() => rmSync(temp, { recursive: true, force: true }))

/** A checkout with a web folder (its themes file) under each of `withThemes`, and a bare web folder under each of `bare`. */
function checkout(name, withThemes, bare = []) {
  const root = join(temp, name)
  for (const dir of withThemes) {
    mkdirSync(join(root, dir, 'Resources/web/themes'), { recursive: true })
    writeFileSync(join(root, dir, 'Resources/web/themes/themes.json'), '[]\n')
  }
  for (const dir of bare) mkdirSync(join(root, dir, 'Resources/web'), { recursive: true })
  return root
}

test("Orbiterm 0.23 and later: the Mac app's folder is mac/, its Swift too", () => {
  const root = checkout('mac', ['mac'])
  assert.deepEqual(checkoutFolders(root), {
    web: join(root, 'mac/Resources/web'),
    swift: join(root, 'mac/Sources/AtalayTerminal/Themes.swift'),
  })
})

test('before 0.23 (Atalay\'s Terminal 0.19): app/', () => {
  const root = checkout('app', ['app'])
  assert.deepEqual(checkoutFolders(root), {
    web: join(root, 'app/Resources/web'),
    swift: join(root, 'app/Sources/AtalayTerminal/Themes.swift'),
  })
})

test('mac/ wins when both are there, and app/ is used when mac/ has no themes file', () => {
  assert.equal(checkoutFolders(checkout('both', ['app', 'mac'])).web, join(temp, 'both/mac/Resources/web'))
  assert.equal(checkoutFolders(checkout('half', ['app'], ['mac'])).web, join(temp, 'half/app/Resources/web'))
})

test('a folder that is neither says so, naming the app and both places it looked', () => {
  const root = checkout('none', [], ['mac', 'app'])
  assert.throws(() => checkoutFolders(root), (error) => {
    assert.match(error.message, /is not an Orbiterm checkout/)
    assert.ok(error.message.includes(root), error.message)
    assert.ok(error.message.includes('mac/Resources/web/themes/themes.json') && error.message.includes('app/Resources/web/themes/themes.json'), error.message)
    return true
  })
})
