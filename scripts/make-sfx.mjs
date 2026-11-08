#!/usr/bin/env node
// The themes' sounds, synthesized here (no recordings): themes/sfx/<slug>/<name>.wav, 16-bit PCM mono at 22.05 kHz.
// Each theme's ui plays them with "--sfx-<name>": "themes/<pack name>/sfx/<slug>/<name>.wav", the folder the preview
// installs them to in the app's web folder.
// Every sound is centred (no DC), faded in and out (no click), its peak at most -6 dBFS and its loudness that of the
// app's own sound for the same moment (sfx.js, rendered in sfx/reference.mjs), so a theme's sounds are no louder than
// the app's. Random choices come from a PRNG seeded by the sound's name: the same bytes every run.
// Run: node scripts/make-sfx.mjs   (--check: list stale files and write nothing; --list: each sound's numbers)
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { centre, fade, loudness, peakOf, prng, RATE, seedOf, times, trim } from './sfx/dsp.mjs'
import { SOUND_NAMES } from './sfx/names.mjs'
import { referenceFor } from './sfx/reference.mjs'
import { encodeWav } from './sfx/wav.mjs'
import cyberpunk from './sfx/themes/cyberpunk-2077.mjs'
import matrix from './sfx/themes/matrix.mjs'
import mw2 from './sfx/themes/modern-warfare-2.mjs'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Each theme's sounds by name: { about, make(rng) → samples }. */
export const DESIGNS = { 'cyberpunk-2077': cyberpunk, matrix, 'modern-warfare-2': mw2 }
/** The loudness each sound name is held to (the loudest 100 ms, RMS, -1..1). */
export const REFERENCE = Object.fromEntries(SOUND_NAMES.map((name) => [name, referenceFor(name)]))
/** The highest a sound's peak may go: -6 dBFS. */
const CEILING = 10 ** (-6 / 20)

/** The installed path a theme's token gives for one of its sounds, from the pack's name. */
const soundPath = (pack, slug, name) => `themes/${pack}/sfx/${slug}/${name}.wav`

/** A sound ready to write: centred, trimmed of its silent tail, faded at both ends, at the app's loudness under the
 *  ceiling. */
function finish(raw, name) {
  const x = fade(trim(centre(raw)))
  const gain = Math.min(CEILING / peakOf(x), REFERENCE[name] / loudness(x))
  return times(x, gain)
}

/** One sound's samples. */
const render = (slug, name) => finish(DESIGNS[slug][name].make(prng(seedOf(`${slug}/${name}`))), name)

/** Every sound file as { path under the pack: WAV bytes }. */
export function buildSfx() {
  const files = {}
  for (const [slug, sounds] of Object.entries(DESIGNS)) {
    for (const name of Object.keys(sounds)) files[`themes/sfx/${slug}/${name}.wav`] = encodeWav(render(slug, name), RATE)
  }
  return files
}

/** What is out of date under `root`: sound files that differ from what buildSfx makes, and theme files missing the
 *  token that plays one (its path made from package.json's name). */
export function staleSfx(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const stale = Object.entries(buildSfx()).filter(([file, bytes]) => {
    try {
      return !readFileSync(join(root, file)).equals(bytes)
    } catch {
      return true
    }
  }).map(([file]) => `${file}: out of date`)
  for (const [slug, sounds] of Object.entries(DESIGNS)) {
    let ui = {}
    try {
      ui = JSON.parse(readFileSync(join(root, 'themes', `${slug}.json`), 'utf8')).ui ?? {}
    } catch {}
    for (const name of Object.keys(sounds)) {
      const want = soundPath(pkg.name, slug, name)
      if (ui[`--sfx-${name}`] !== want) stale.push(`themes/${slug}.json: ui needs "--sfx-${name}": "${want}"`)
    }
  }
  return stale
}

const dB = (x) => `${(20 * Math.log10(x)).toFixed(1)}`
/** Each sound's numbers, a line each: duration, peak (dBFS), loudness against the app's (dB), what it is. */
function listSfx() {
  return Object.entries(DESIGNS).flatMap(([slug, sounds]) => Object.entries(sounds).map(([name, { about }]) => {
    const x = render(slug, name)
    return `${slug}/${name}: ${(x.length / RATE).toFixed(2)} s, peak ${dB(peakOf(x))} dBFS, ${dB(loudness(x))} dB (app ${dB(REFERENCE[name])}). ${about}`
  }))
}

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--list')) {
    for (const line of listSfx()) console.log(line)
  } else if (process.argv.includes('--check')) {
    const stale = staleSfx()
    for (const line of stale) console.error(`${line}, run node scripts/make-sfx.mjs`)
    if (stale.length) process.exit(1)
    console.log('ok: sounds up to date')
  } else {
    const files = buildSfx()
    let wrote = 0
    for (const [file, bytes] of Object.entries(files)) {
      let same = false
      try {
        same = readFileSync(join(ROOT, file)).equals(bytes)
      } catch {}
      if (same) continue
      mkdirSync(dirname(join(ROOT, file)), { recursive: true })
      writeFileSync(join(ROOT, file), bytes)
      console.log(`wrote ${file}`)
      wrote++
    }
    const tokens = staleSfx().filter((line) => !line.endsWith(': out of date'))
    for (const line of tokens) console.error(line)
    if (!wrote && !tokens.length) console.log('ok: sounds up to date')
    if (tokens.length) process.exit(1)
  }
}
