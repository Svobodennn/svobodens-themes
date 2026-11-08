import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack } from '../scripts/check.mjs'
import { wavErrors } from '../scripts/sfx/wav.mjs'
import { buildSfx, DESIGNS, REFERENCE, staleSfx } from '../scripts/make-sfx.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** A WAV file's bytes, built by hand so the checker's verdict doesn't rest on the pack's own writer. */
function wav({ format = 1, channels = 1, rate = 22050, bits = 16, frames = 64, riff = 'RIFF', wave = 'WAVE', fmt = true, data = true, dataSize } = {}) {
  const block = (channels * bits) / 8
  const body = Buffer.alloc(frames * block)
  const fmtChunk = Buffer.alloc(24)
  fmtChunk.write('fmt ', 0)
  fmtChunk.writeUInt32LE(16, 4)
  fmtChunk.writeUInt16LE(format, 8)
  fmtChunk.writeUInt16LE(channels, 10)
  fmtChunk.writeUInt32LE(rate, 12)
  fmtChunk.writeUInt32LE(rate * block, 16)
  fmtChunk.writeUInt16LE(block, 20)
  fmtChunk.writeUInt16LE(bits, 22)
  const dataHead = Buffer.alloc(8)
  dataHead.write('data', 0)
  dataHead.writeUInt32LE(dataSize ?? body.length, 4)
  const chunks = Buffer.concat([...(fmt ? [fmtChunk] : []), ...(data ? [dataHead, body] : [])])
  const head = Buffer.alloc(12)
  head.write(riff, 0)
  head.writeUInt32LE(4 + chunks.length, 4)
  head.write(wave, 8)
  return Buffer.concat([head, chunks])
}

test('a PCM WAV, mono or stereo, is valid; anything the app might not play is named', () => {
  assert.deepEqual(wavErrors(wav()), [])
  assert.deepEqual(wavErrors(wav({ channels: 2, rate: 44100 })), [])
  assert.deepEqual(wavErrors(wav({ riff: 'RIFX' })), ['not a RIFF/WAVE file'])
  assert.deepEqual(wavErrors(wav({ wave: 'AVI ' })), ['not a RIFF/WAVE file'])
  assert.deepEqual(wavErrors(wav().subarray(0, 10)), ['not a RIFF/WAVE file'])
  assert.deepEqual(wavErrors(wav({ format: 3, bits: 32 })), ['not PCM (format 3)'])
  assert.deepEqual(wavErrors(wav({ channels: 3 })), ['has 3 channels, not mono or stereo'])
  assert.deepEqual(wavErrors(wav({ fmt: false })), ['has no fmt chunk'])
  assert.deepEqual(wavErrors(wav({ data: false })), ['has no data chunk'])
  assert.deepEqual(wavErrors(wav({ dataSize: 1000 })), ['its data runs past the end of the file'])
  assert.deepEqual(wavErrors(wav({ frames: 0 })), ['has no samples'])
})

const roots = []
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))
const ID = 'svoboden-test'
const PREFIX = 'themes/svobodens-themes/sfx/'
/** A pack with one theme whose ui is `ui`, and `files` under themes/ (Buffers as they are). */
function pack(ui, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'svobodens-themes-sfx-'))
  roots.push(root)
  const pkg = {
    name: 'svobodens-themes', displayName: "Svoboden's Themes", version: '0.0.1', publisher: 'svoboden',
    engines: { 'atalay-terminal': '>=0.16.0' }, categories: ['Themes'],
    contributes: { themes: [{ id: ID, label: 'Test', uiTheme: 'vs-dark', path: './themes/test.json' }] },
  }
  const theme = {
    id: ID, name: 'Test', bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a', accent: '#bd93f9',
    ansi: Array(16).fill('#21222c'), ui: { '--theme-id': ID, ...ui },
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  for (const [name, body] of Object.entries({ 'test.json': JSON.stringify(theme), ...files })) {
    mkdirSync(dirname(join(root, 'themes', name)), { recursive: true })
    writeFileSync(join(root, 'themes', name), body)
  }
  return checkPack(root).errors
}

test("a theme's sounds: none, or a pack file by its installed path, bare or quoted", () => {
  const ui = {
    '--sfx-wait': `${PREFIX}t/wait.wav`, '--sfx-message': `"${PREFIX}t/message.wav"`, '--sfx-clash': `'${PREFIX}t/wait.wav'`,
    '--sfx-send': 'none', '--sfx-ping-waiting': ` ${PREFIX}t/wait.wav `, '--sfx-streak-break': `${PREFIX}t/sub dir/x.wav`,
    '--sfx-badge-impact': `${PREFIX}./t/message.wav`,
  }
  assert.deepEqual(pack(ui, { 'sfx/t/wait.wav': wav(), 'sfx/t/message.wav': wav({ channels: 2 }), 'sfx/t/sub dir/x.wav': wav(), 'sfx/t/.DS_Store': 'x' }), [])
  // Every name the app (or a theme hook) plays.
  for (const name of ['wait', 'message', 'request', 'friend', 'online', 'accept', 'decline', 'send', 'xp', 'glitch', 'levelup', 'rankup', 'fire',
    'alarm', 'hit', 'boom', 'clash', 'ping-waiting', 'ping-idle', 'badge-impact', 'badge-shine', 'badge-equip', 'streak', 'streak-break', 'back', 'theme-kept']) {
    assert.deepEqual(pack({ [`--sfx-${name}`]: 'none' }), [], name)
  }
})

test("a sound name the app never plays is caught, and a value it wouldn't play or that isn't the pack's", () => {
  assert.deepEqual(pack({ '--sfx-ding': 'none', '--sfx-ping': 'none' }), [
    'themes/test.json: ui "--sfx-ding" is not a sound the app plays',
    'themes/test.json: ui "--sfx-ping" is not a sound the app plays',
  ])
  const bad = [
    '', 'url(themes/svobodens-themes/sfx/t/wait.wav)', `${PREFIX}../../x.wav`, `${PREFIX}t/../t/wait.wav`, `/${PREFIX}t/wait.wav`,
    `file://${PREFIX}t/wait.wav`, `"${PREFIX}t/wait.wav'`, 'themes/other-pack/sfx/t/wait.wav', 'sfx/t/wait.wav', 'themes/svobodens-themes/t/wait.wav',
    `${PREFIX}t/wait.m4a`, `${PREFIX}t/wait%20.wav`, `${PREFIX}t/wa\\it.wav`, `${PREFIX}t/wait.wav;x`,
  ]
  for (const value of bad) {
    assert.deepEqual(pack({ '--sfx-wait': value }, { 'sfx/t/wait.wav': wav() }),
      [`themes/test.json: ui "--sfx-wait" ${JSON.stringify(value)} is not none or a .wav under ${PREFIX}`, 'themes/sfx/t/wait.wav: no theme uses it'], value)
  }
})

test('the file a sound points at is there, a valid WAV, small, and every sound file is used', () => {
  assert.deepEqual(pack({ '--sfx-wait': `${PREFIX}t/wait.wav` }), ['themes/test.json: ui "--sfx-wait" points at themes/sfx/t/wait.wav, which is missing'])
  // A broken file is reported once, however many sounds point at it.
  assert.deepEqual(pack({ '--sfx-wait': `${PREFIX}t/wait.wav`, '--sfx-clash': `${PREFIX}t/wait.wav` }, { 'sfx/t/wait.wav': wav({ format: 3, bits: 32 }) }),
    ['themes/sfx/t/wait.wav: not PCM (format 3)'])
  const big = wav({ frames: 160 * 1024 })
  assert.ok(big.length > 300 * 1024)
  assert.deepEqual(pack({ '--sfx-wait': `${PREFIX}t/wait.wav` }, { 'sfx/t/wait.wav': big }), [`themes/sfx/t/wait.wav: ${Math.ceil(big.length / 1024)} KB, over the 300 KB cap`])
  assert.deepEqual(pack({ '--sfx-wait': `${PREFIX}t/wait.wav` }, { 'sfx/t/wait.wav': wav({ frames: 150 * 1024 - 64 }) }), [])
  assert.deepEqual(pack({ '--sfx-wait': `${PREFIX}t/wait.wav` }, { 'sfx/t/wait.wav': wav(), 'sfx/old.wav': wav(), 'sfx/u/notes.txt': 'x' }),
    ['themes/sfx/old.wav: no theme uses it', 'themes/sfx/u/notes.txt: no theme uses it'])
  assert.deepEqual(pack({}, { sfx: 'not a folder' }), ['themes/sfx: not a folder'])
})

// ---------------------------------------------------------------- the pack's own sounds

const SFX = join(ROOT, 'themes/sfx')
const files = readdirSync(SFX, { recursive: true }).filter((f) => f.endsWith('.wav')).sort()
const RINGS = new Set(['wait', 'ping-waiting', 'levelup', 'rankup', 'badge-impact', 'badge-shine'])
const dB = (x) => 20 * Math.log10(x)

/** A 16-bit mono WAV's samples as -1..1, read straight from its bytes. */
function samples(file) {
  const buf = readFileSync(join(SFX, file))
  assert.deepEqual(wavErrors(buf), [], file)
  assert.equal(buf.toString('ascii', 12, 16), 'fmt ', `${file}: fmt first`)
  assert.equal(buf.readUInt16LE(22), 1, `${file}: mono`)
  assert.equal(buf.readUInt16LE(34), 16, `${file}: 16-bit`)
  const rate = buf.readUInt32LE(24)
  assert.ok(rate === 22050 || rate === 44100, `${file}: ${rate} Hz`)
  assert.equal(buf.toString('ascii', 36, 40), 'data', `${file}: data after fmt`)
  const n = buf.readUInt32LE(40) / 2
  return { rate, x: Float64Array.from({ length: n }, (_, i) => buf.readInt16LE(44 + 2 * i) / 32768) }
}

test('each theme has the sounds its design names, and nothing else is in the folder', () => {
  const made = Object.entries(DESIGNS).flatMap(([slug, sounds]) => Object.keys(sounds).map((name) => `${slug}/${name}.wav`)).sort()
  assert.deepEqual(files.map((f) => f.split('\\').join('/')), made)
  assert.ok(made.length >= 20, `${made.length} sounds`)
})

test('every sound file: short, its peak at most -6 dBFS and audible, centred, no click at either end', () => {
  for (const file of files) {
    const { rate, x } = samples(file)
    const name = file.split(/[\\/]/).pop().replace(/\.wav$/, '')
    const seconds = x.length / rate
    assert.ok(seconds >= 0.05 && seconds <= (RINGS.has(name) ? 2.5 : 1.5), `${file}: ${seconds.toFixed(2)} s`)
    const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    assert.ok(dB(peak) <= -5.9 && dB(peak) >= -30, `${file}: peak ${dB(peak).toFixed(1)} dBFS`)
    const mean = x.reduce((s, v) => s + v, 0) / x.length
    assert.ok(Math.abs(mean) <= 0.002, `${file}: DC ${mean.toFixed(4)}`)
    assert.ok(Math.abs(x[0]) <= 0.001 && Math.abs(x[x.length - 1]) <= 0.001, `${file}: ends ${x[0]}, ${x[x.length - 1]}`)
    // The first and last millisecond rise from and fall to silence.
    const ms = Math.round(rate / 1000)
    for (const edge of [x.subarray(0, ms), x.subarray(x.length - ms)]) assert.ok(edge.every((v) => Math.abs(v) < 0.05), `${file}: an edge jumps`)
  }
})

test("every sound is as loud as the app's own for that moment, never louder", () => {
  for (const file of files) {
    const { rate, x } = samples(file)
    const name = file.split(/[\\/]/).pop().replace(/\.wav$/, '')
    // The loudest 100 ms, as RMS.
    const w = Math.round(rate / 10)
    let sum = 0
    let loudest = 0
    for (let i = 0; i < x.length; i++) {
      sum += x[i] * x[i] - (i >= w ? x[i - w] * x[i - w] : 0)
      loudest = Math.max(loudest, sum)
    }
    const level = dB(Math.sqrt(loudest / w))
    const target = dB(REFERENCE[name])
    const peak = dB(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0))
    assert.ok(level <= target + 0.5, `${file}: ${level.toFixed(1)} dB, the app's ${target.toFixed(1)}`)
    // Quieter only when its peak already sits at the ceiling.
    if (peak < -6.2) assert.ok(level >= target - 0.5, `${file}: ${level.toFixed(1)} dB, the app's ${target.toFixed(1)}`)
  }
})

test('the pack stays small', () => {
  const total = files.reduce((s, f) => s + statSync(join(SFX, f)).size, 0)
  assert.ok(total < 1.5 * 1024 * 1024, `${(total / 1024).toFixed(0)} KB`)
})

test('the sounds are made the same, byte for byte, every run, and the files are what the generator makes', () => {
  const a = buildSfx()
  const b = buildSfx()
  assert.deepEqual(Object.keys(a), Object.keys(b))
  for (const file of Object.keys(a)) assert.ok(a[file].equals(b[file]), file)
  assert.deepEqual(staleSfx(), [], 'run: node scripts/make-sfx.mjs')
})

test("each theme's sound tokens point at its own files, at the folder the preview installs them to", () => {
  for (const entry of PKG.contributes.themes) {
    const slug = entry.path.replace(/^\.\/themes\/|\.json$/g, '')
    const ui = JSON.parse(readFileSync(join(ROOT, entry.path), 'utf8')).ui
    const tokens = Object.fromEntries(Object.entries(ui).filter(([k]) => k.startsWith('--sfx-')))
    const want = Object.fromEntries(Object.keys(DESIGNS[slug]).map((name) => [`--sfx-${name}`, `themes/${PKG.name}/sfx/${slug}/${name}.wav`]))
    assert.deepEqual(tokens, want, slug)
  }
})

test("a badge sound's moment falls where the app's own does (0.36 s in for badge-equip), as the app lines it up", () => {
  const MOMENT = { 'badge-impact': 1.62, 'badge-shine': 1.07, 'badge-equip': 0.36 }
  const badges = files.filter((f) => /badge-[a-z]+\.wav$/.test(f))
  assert.ok(badges.length > 0)
  for (const file of badges) {
    const { rate, x } = samples(file)
    const name = file.split(/[\\/]/).pop().replace(/\.wav$/, '')
    // The sharpest rise in 5 ms energy is the hit.
    const w = Math.round(rate / 200)
    const energy = (at) => x.subarray(at, at + w).reduce((s, v) => s + v * v, 0)
    let hit = 0
    let best = 0
    for (let i = w; i + w < x.length; i += Math.round(w / 4)) {
      const rise = energy(i) - energy(i - w)
      if (rise > best) [best, hit] = [rise, i]
    }
    assert.ok(Math.abs(hit / rate - MOMENT[name]) <= 0.015, `${file}: hit at ${(hit / rate).toFixed(3)} s`)
  }
})
