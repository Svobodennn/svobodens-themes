// Instruments the themes' sounds share, made from dsp.mjs.
import { add, filter, fm, glide, osc, perc, RATE, samples, shape, times } from './dsp.mjs'

/** A struck FM bell or glass: carrier `freq`, the modulator at × `ratio`, its brightness dying with the note. */
export function bell(seconds, freq, { ratio = 3.5, index = 2.5, tau = 0.25, attack = 0.003 } = {}) {
  return times(fm(seconds, freq, ratio, (t) => index * Math.exp(-t / (tau * 0.6))), perc(seconds, attack, tau))
}

/** A gated tone: up in `attack`, held, down over the last 10 ms (a beep, a pulse, a blip). */
export function beep(seconds, freq, type = 'square', attack = 0.002) {
  return times(osc(seconds, freq, { type }), shape(seconds, [[0, 0], [attack, 1], [Math.max(attack, seconds - 0.01), 1], [seconds, 0]], 1))
}

/** A band of the spectrum, as a telephone or a radio passes it. */
export const band = (x, low, high, q = 0.8) => filter(filter(x, 'highpass', low, q), 'lowpass', high, q)

/** A low drum hit: a sine falling from `from` to `to` Hz, decaying with `tau`. */
export const thump = (seconds, from, to, tau) => times(osc(seconds, glide(from, to, seconds * 0.5)), perc(seconds, 0.003, tau))

/** Frequency-shift keying, a modem's data: random bits at `baud`, each sent as one of two tones, phase unbroken. */
export function fsk(seconds, rng, [space, mark], baud) {
  const bits = Array.from({ length: Math.ceil(seconds * baud) + 1 }, () => rng() < 0.5)
  return osc(seconds, (t) => (bits[Math.floor(t * baud)] ? mark : space))
}

/** A chopper: a gate opening and closing at random every 15-45 ms, open `open` of the time (a glitch's stutter). */
export function stutter(seconds, rng, open = 0.6) {
  const out = new Float64Array(samples(seconds))
  for (let at = 0; at < out.length; ) {
    const len = Math.round((0.015 + rng() * 0.03) * RATE)
    const on = rng() < open ? 1 : 0
    out.fill(on, at, at + len)
    at += len
  }
  return out
}

/** A synth voice: a square and a slightly sharp saw through a resonant low-pass that closes as the note goes. */
export function synth(seconds, freq, { cutoff = 5, close = 8, q = 2.5, sustain = 0.7 } = {}) {
  const tone = add(osc(seconds, freq, { type: 'square' }), osc(seconds, freq * 1.005, { type: 'saw' }), 0, 0.6)
  const env = shape(seconds, [[0, 0], [0.004, 1], [seconds * 0.6, sustain], [seconds, 0]], 2)
  return times(filter(tone, 'lowpass', (t) => freq * (1 + cutoff * Math.exp(-t * close)), q), env)
}

/** A brass-like chord: three detuned saws a note through a low-pass gliding from `bright` to `dark` Hz. */
export function brass(seconds, freqs, { bright = 4000, dark = 900, attack = 0.012, hold = 0.25 } = {}) {
  const tone = new Float64Array(samples(seconds))
  for (const f of freqs) for (const cents of [-9, 0, 8]) add(tone, osc(seconds, f * 2 ** (cents / 1200), { type: 'saw' }), 0, 1 / freqs.length / 3)
  const stop = Math.min(hold, seconds)
  const env = shape(seconds, [[0, 0], [attack, 1], [Math.min(attack + 0.12, stop), 0.6], [stop, 0.5], [seconds, 0]], 2)
  return times(filter(tone, 'lowpass', glide(bright, dark, seconds * 0.8), 1.1), env)
}
