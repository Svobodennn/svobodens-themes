// Cyberpunk 2077: hard synths, bit-crush and glitches. Original motifs, none of the game's.
import { add, crush, echo, filter, glide, noise, osc, perc, reverb, shape, silence, times } from '../dsp.mjs'
import { band, beep, bell, stutter, synth, thump } from '../parts.mjs'

/** The tail a holocall trails off with: noise chopped into stutters, a resonant band sliding down, crushed. */
function glitchTail(rng, seconds, freq) {
  const n = filter(noise(seconds, rng), 'bandpass', glide(freq * 2, freq / 2, seconds), 6)
  return crush(times(times(n, stutter(seconds, rng, 0.55)), shape(seconds, [[0, 1], [seconds, 0]], 2)), 5, 3)
}

/** A holocall: pulses alternating between notes, then the glitch tail. */
function holocall(rng, notes, { step = 0.11, pulse = 0.075, last = pulse } = {}) {
  const end = (notes.length - 1) * step + last
  const out = silence(end + 0.32)
  notes.forEach((f, i) => add(out, synth(i === notes.length - 1 ? last : pulse, f, { cutoff: 4, close: 18 }), i * step, 0.4))
  add(out, glitchTail(rng, 0.3, notes[notes.length - 1]), end, 0.35)
  return echo(out, { time: 0.11, feedback: 0.25, wet: 0.25, tail: 0.15 })
}

/** A rising arpeggio landing on a sub-bass hit and a held, closing chord. */
function ascent(rng, run, step, { chord, hold, hits }) {
  const top = run.length * step
  const out = silence(top + hold + 0.1)
  run.forEach((f, i) => add(out, synth(0.12, f, { cutoff: 6, close: 14 }), i * step, 0.28))
  for (const at of hits) {
    add(out, thump(0.6, 110, 42, 0.2), top + at, 0.9)
    add(out, times(filter(noise(0.08, rng), 'highpass', 3000), perc(0.08, 0.001, 0.02)), top + at, 0.35)
  }
  for (const f of chord) add(out, synth(hold, f, { cutoff: 7, close: 2.5, sustain: 0.8 }), top, 0.16)
  add(out, crush(times(filter(noise(hold, rng), 'bandpass', glide(6000, 1500, hold), 4), shape(hold, [[0, 0.6], [hold, 0]], 2)), 5, 4), top, 0.06)
  return echo(out, { time: 0.12, feedback: 0.25, wet: 0.2, tail: 0.2 })
}

export default {
  message: {
    about: 'a holocall ring: a two-note pulsed synth (C#6, F#5) trailing off in a filtered, crushed glitch',
    make: (rng) => holocall(rng, [1108.73, 739.99, 1108.73, 739.99]),
  },
  request: {
    about: 'the holocall, a tone up and a pulse longer: someone new is calling',
    make: (rng) => holocall(rng, [1244.51, 830.61, 1244.51, 830.61, 1244.51]),
  },
  friend: {
    about: 'the holocall answered: two pulses, then a held A6 above them',
    make: (rng) => holocall(rng, [1108.73, 739.99, 1760], { last: 0.2 }),
  },
  wait: {
    about: 'a HUD alert: two sharp double beeps (A6 and its fifth, square), crushed to 5 bits',
    make() {
      const out = silence(0.66)
      for (const at of [0, 0.11, 0.4, 0.51]) {
        const tone = add(beep(0.07, 1760), beep(0.07, 2640), 0, 0.35)
        add(out, tone, at, 0.45)
      }
      return echo(filter(crush(out, 5, 3), 'lowpass', 7000), { time: 0.06, feedback: 0.2, wet: 0.2, tail: 0.15 })
    },
  },
  clash: {
    about: 'a glitch burst: stuttering band-passed noise over a square diving from 1.6 kHz to 80 Hz',
    make(rng) {
      const d = 0.42
      const n = times(times(filter(noise(d, rng), 'bandpass', 2500, 1), stutter(d, rng, 0.65)), perc(d, 0.002, 0.12))
      const dive = times(osc(0.32, glide(1600, 80, 0.3), { type: 'square' }), perc(0.32, 0.003, 0.1))
      const out = add(add(silence(d), n, 0, 0.5), dive, 0, 0.3)
      return crush(out, 6, 4)
    },
  },
  levelup: {
    about: 'a rising cyber arpeggio (A minor, A3 to A5) landing on a sub-bass hit and a closing A5 power chord',
    make: (rng) => ascent(rng, [220, 261.63, 329.63, 440, 523.25, 659.25, 880], 0.065, { chord: [440, 659.25, 880], hold: 1.0, hits: [0] }),
  },
  rankup: {
    about: 'the level-up climb over two octaves and faster, two sub-bass hits, a wider chord held longer',
    make: (rng) => ascent(rng, [110, 130.81, 164.81, 220, 261.63, 329.63, 440, 523.25, 659.25, 880, 1046.5], 0.045,
      { chord: [220, 329.63, 440, 659.25, 987.77], hold: 1.3, hits: [0, 0.14] }),
  },
  xp: {
    about: 'an eddies chime: two quick metallic FM strikes (E6, B6) over a coin-like click, a crushed glint',
    make(rng) {
      const out = silence(0.5)
      add(out, times(filter(noise(0.012, rng), 'highpass', 5000), perc(0.012, 0.0005, 0.003)), 0, 0.4)
      add(out, bell(0.35, 1318.51, { ratio: 3.5, index: 3, tau: 0.09 }), 0, 0.35)
      add(out, bell(0.42, 1975.53, { ratio: 3.5, index: 2.5, tau: 0.14 }), 0.07, 0.35)
      return echo(add(out, crush(out, 7, 2), 0, 0.25), { time: 0.08, feedback: 0.2, wet: 0.2, tail: 0.12 })
    },
  },
  streak: {
    about: 'a quickhack "upload complete": eight blips racing up, then a low-high confirm',
    make() {
      const out = silence(0.62)
      for (let i = 0; i < 8; i++) add(out, beep(0.018, 600 * 2 ** (i / 3.5)), i * 0.028, 0.25)
      add(out, synth(0.09, 880, { cutoff: 4, close: 12 }), 0.27, 0.4)
      add(out, synth(0.22, 1760, { cutoff: 4, close: 10 }), 0.36, 0.4)
      return echo(band(crush(out, 6, 2), 120, 8000), { time: 0.1, feedback: 0.25, wet: 0.2, tail: 0.15 })
    },
  },
  'badge-equip': {
    about: 'a quickhack charge: a filtered saw rising into a metal slam at 0.36 s (a sub thump, an inharmonic strike)',
    make(rng) {
      const out = silence(0.95)
      const rise = filter(osc(0.33, glide(110, 880, 0.33), { type: 'saw' }), 'lowpass', glide(300, 5000, 0.33), 3)
      add(out, times(rise, shape(0.33, [[0, 0], [0.3, 1], [0.33, 0]], 1)), 0.03, 0.3)
      add(out, thump(0.4, 120, 45, 0.12), 0.36, 0.8)
      add(out, bell(0.5, 523.25, { ratio: 1.414, index: 4, tau: 0.12 }), 0.36, 0.35)
      add(out, crush(times(filter(noise(0.2, rng), 'highpass', 2500), perc(0.2, 0.001, 0.04)), 6, 3), 0.36, 0.3)
      return echo(out, { time: 0.12, feedback: 0.25, wet: 0.2, tail: 0.15 })
    },
  },
}
