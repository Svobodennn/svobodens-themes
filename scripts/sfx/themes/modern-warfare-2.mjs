// Modern Warfare 2: radios, cockpit warnings and punchy stabs. Original sounds in the genre's manner, none of the game's.
import { add, drive, filter, glide, noise, osc, perc, reverb, shape, silence, times } from '../dsp.mjs'
import { band, beep, bell, brass, thump } from '../parts.mjs'

/** A radio's key click: a few samples of ringing, alternating. */
const click = (rng, level = 1) => Float64Array.from({ length: 40 }, (_, k) => level * Math.exp(-k / 6) * (k % 2 ? -0.7 : 1) * (0.8 + 0.2 * rng()))

/** A squelch: a burst of band-passed static. */
function squelch(rng, seconds, low = 900, high = 3000) {
  return times(band(noise(seconds, rng), low, high, 1), shape(seconds, [[0, 0], [0.004, 1], [seconds * 0.6, 0.6], [seconds, 0]], 2))
}

/** A stinger: a pickup stab, then the hit (a kick, a snare's crack, a brass chord), in a small room. */
function stinger(rng, { pickups, chord, hold, top }) {
  const hit = pickups.length * 0.11
  const out = silence(hit + hold + 0.05)
  pickups.forEach((freqs, i) => add(out, brass(0.09, freqs, { hold: 0.06, attack: 0.006 }), i * 0.11, 0.55))
  add(out, thump(0.4, 120, 45, 0.12), hit, 0.9)
  add(out, times(band(noise(0.2, rng), 1500, 6000), perc(0.2, 0.001, 0.05)), hit, 0.45)
  add(out, brass(hold, chord, { hold: hold * 0.5 }), hit, 0.9)
  if (top) add(out, bell(hold, top, { ratio: 2, index: 1.2, tau: 0.3 }), hit + 0.05, 0.12)
  return reverb(drive(out, 1.4), { room: 0.45, wet: 0.18, tail: 0.3 })
}

export default {
  wait: {
    about: 'an incoming-missile warning: eleven fast 1 kHz pulses from a cockpit speaker',
    make() {
      const out = silence(1.0)
      for (let i = 0; i < 11; i++) add(out, add(beep(0.045, 1000, 'square', 0.003), beep(0.045, 1000, 'sine', 0.003), 0, 1.5), i * 0.09, 0.3)
      return drive(band(out, 500, 4000), 1.8)
    },
  },
  message: {
    about: 'radio squelch: a key click, a burst of band-passed static, a click as it closes',
    make(rng) {
      const out = silence(0.3)
      add(out, click(rng), 0.008, 0.6)
      add(out, squelch(rng, 0.2), 0.01, 0.5)
      add(out, click(rng, 0.6), 0.215, 0.6)
      return drive(out, 1.6)
    },
  },
  request: {
    about: 'a radio "roger" chirp: a short squelch, then 1200 and 1800 Hz back to back, a click to close',
    make(rng) {
      const out = silence(0.32)
      add(out, squelch(rng, 0.07), 0.008, 0.35)
      add(out, add(beep(0.06, 1200, 'sine', 0.004), beep(0.06, 1200, 'square', 0.004), 0, 0.25), 0.08, 0.4)
      add(out, add(beep(0.07, 1800, 'sine', 0.004), beep(0.07, 1800, 'square', 0.004), 0, 0.25), 0.14, 0.4)
      add(out, click(rng, 0.5), 0.215, 0.5)
      return drive(band(out, 400, 3200), 2)
    },
  },
  clash: {
    about: 'a friendly-fire double tone: two harsh buzzes, the second a fourth lower',
    make() {
      const buzz = (f) => add(beep(0.15, f, 'square', 0.004), beep(0.15, f * 1.007, 'saw', 0.004), 0, 0.6)
      const out = silence(0.36)
      add(out, buzz(740), 0, 0.3)
      add(out, buzz(554.37), 0.19, 0.3)
      return drive(band(out, 300, 3500), 2.2)
    },
  },
  levelup: {
    about: 'a punchy rank-up stinger: a short pickup stab, then a kick, a crack and a bright D major brass chord',
    make: (rng) => stinger(rng, { pickups: [[220, 277.18, 329.63]], chord: [146.83, 220, 293.66, 369.99], hold: 1.1 }),
  },
  rankup: {
    about: 'the stinger bigger: two pickup stabs climbing, a wider D major chord held longer, a bell on top',
    make: (rng) => stinger(rng, { pickups: [[196, 246.94, 293.66], [220, 277.18, 329.63]], chord: [73.42, 146.83, 220, 293.66, 369.99, 440], hold: 1.6, top: 1174.66 }),
  },
  streak: {
    about: 'a hitmarker-style tick, then a two-note reward chime (G6, D7)',
    make(rng) {
      const out = silence(0.75)
      add(out, times(filter(noise(0.012, rng), 'highpass', 4000), perc(0.012, 0.0005, 0.003)), 0.008, 0.5)
      add(out, times(osc(0.03, 3200), perc(0.03, 0.0008, 0.008)), 0.008, 0.35)
      add(out, bell(0.5, 1567.98, { ratio: 2, index: 1.2, tau: 0.16 }), 0.11, 0.3)
      add(out, bell(0.55, 2349.32, { ratio: 2, index: 1.0, tau: 0.2 }), 0.19, 0.3)
      return reverb(out, { room: 0.4, wet: 0.15, tail: 0.15 })
    },
  },
  'streak-break': {
    about: 'a low, dull thud: a sine falling from 95 to 42 Hz in muffled noise',
    make(rng) {
      const out = add(thump(0.45, 95, 42, 0.12), times(filter(noise(0.45, rng), 'lowpass', 300), perc(0.45, 0.002, 0.05)), 0, 0.5)
      return filter(out, 'lowpass', 400)
    },
  },
  'theme-kept': {
    about: 'a radio connecting: static opening up, a chirp sliding 900 to 1800 Hz, a confirming tone, a click',
    make(rng) {
      const out = silence(0.32)
      add(out, times(band(noise(0.08, rng), 600, 2600, 1), perc(0.08, 0.004, 0.03)), 0.006, 0.4)
      add(out, times(add(osc(0.07, glide(900, 1800, 0.07)), osc(0.07, glide(900, 1800, 0.07), { type: 'tri' }), 0, 0.5), shape(0.07, [[0, 0], [0.004, 1], [0.065, 1], [0.07, 0]], 1)), 0.08, 0.4)
      add(out, beep(0.05, 1800, 'sine', 0.004), 0.16, 0.35)
      add(out, click(rng, 0.5), 0.22, 0.5)
      return drive(band(out, 400, 3200), 1.8)
    },
  },
  'badge-equip': {
    about: 'gear clipped on: three short rattles, then a metallic clank at 0.36 s ringing off',
    make(rng) {
      const out = silence(0.9)
      for (const at of [0.08, 0.17, 0.25]) add(out, times(band(noise(0.025, rng), 2000, 6000), perc(0.025, 0.001, 0.006)), at, 0.3)
      add(out, click(rng, 0.8), 0.36, 0.5)
      add(out, bell(0.5, 880, { ratio: 1.41, index: 3, tau: 0.1 }), 0.36, 0.3)
      add(out, bell(0.4, 1243, { ratio: 2.76, index: 2, tau: 0.08 }), 0.36, 0.2)
      add(out, thump(0.25, 160, 70, 0.05), 0.36, 0.5)
      return reverb(out, { room: 0.4, wet: 0.15, tail: 0.2 })
    },
  },
}
