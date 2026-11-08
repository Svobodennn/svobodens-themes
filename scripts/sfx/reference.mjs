// How loud the app's own sounds are, so a theme's stand in at the same level: sfx.js's notes, swell and output bus
// (out 0.9, an echo of 0.13 s at feedback 0.28 and wet 0.3), rendered here as Web Audio renders them (Atalay's Terminal
// 0.19). A file the app plays with new Audio() goes out at volume 1, so its samples compare with these directly.
import { loudness, osc, RATE, samples, silence } from './dsp.mjs'

// AudioParam.exponentialRampToValueAtTime between [time, value] points; the first value before, the last after.
function ramps(seconds, points) {
  return Float64Array.from({ length: samples(seconds) }, (_, i) => {
    const t = i / RATE
    if (t <= points[0][0]) return points[0][1]
    for (let k = 1; k < points.length; k++) {
      const [t0, v0] = points[k - 1]
      const [t1, v1] = points[k]
      if (t <= t1) return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0))
    }
    return points[points.length - 1][1]
  })
}

// sfx.js note(): the tone and a quieter octave, 8 ms up, fading out over dur (the octave over 0.6 of it). A ramp to 0
// (bright: 0) throws in Web Audio, as here: the app's try/catch then drops the rest of that sound.
function note(into, freq, at, { dur = 0.45, vol = 0.11, type = 'sine', bright = 0.35 } = {}) {
  for (const [mult, level] of [[1, 1], [2, bright]]) {
    if (!(vol * level > 0)) throw new RangeError('exponentialRampToValueAtTime: value must not be 0')
    const len = dur + 0.05
    const end = dur * (mult === 1 ? 1 : 0.6)
    const env = ramps(len, [[0, 0.0001], [0.008, vol * level], [end, 0.0001]])
    const tone = osc(len, freq * mult, { type: type === 'triangle' ? 'tri' : type })
    for (let i = 0; i < tone.length; i++) into[samples(at) + i] += tone[i] * env[i]
  }
}

// sfx.js swell(): a sine gliding from one pitch to another, swelling in and out.
function swell(into, from, to, at, dur, vol) {
  const len = dur + 0.05
  const env = ramps(len, [[0, 0.0001], [dur * 0.4, vol], [dur, 0.0001]])
  const tone = osc(len, (t) => from * (to / from) ** Math.min(1, t / dur))
  for (let i = 0; i < tone.length; i++) into[samples(at) + i] += tone[i] * env[i]
}

// sfx.js audio(): out (0.9) to the speakers and into the echo, whose loop's wet share (0.3) joins them.
function bus(x) {
  const d = samples(0.13)
  const out = new Float64Array(x.length + samples(1))
  const loop = new Float64Array(out.length)
  for (let i = 0; i < out.length; i++) {
    loop[i] = i >= d ? 0.9 * (x[i - d] ?? 0) + 0.28 * loop[i - d] : 0
    out[i] = 0.9 * (x[i] ?? 0) + 0.3 * loop[i]
  }
  return out
}

const render = (seconds, play) => {
  const x = silence(seconds)
  try {
    play(x)
  } catch {}
  return bus(x)
}

// The app's sounds as sfx.js's SOUNDS has them.
const APP = {
  wait: () => render(1, (x) => {
    note(x, 783.99, 0, { dur: 0.14, type: 'triangle', vol: 0.1, bright: 0.25 })
    note(x, 783.99, 0.16, { dur: 0.14, type: 'triangle', vol: 0.1, bright: 0.25 })
    note(x, 1174.66, 0.32, { dur: 0.42, type: 'triangle', vol: 0.09, bright: 0.25 })
  }),
  message: () => render(0.8, (x) => {
    note(x, 880, 0, { dur: 0.32 })
    note(x, 1318.5, 0.085, { dur: 0.5 })
  }),
  request: () => render(0.8, (x) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(x, f, i * 0.07, { dur: 0.38, type: 'triangle', vol: 0.09, bright: 0.2 }))),
  friend: () => render(1, (x) => {
    ;[523.25, 659.25, 783.99].forEach((f) => note(x, f, 0, { dur: 0.7, type: 'triangle', vol: 0.07, bright: 0.15 }))
    note(x, 2093, 0.12, { dur: 0.35, vol: 0.05, bright: 0 })
  }),
  xp: () => render(0.8, (x) => {
    note(x, 1567.98, 0, { dur: 0.12, type: 'triangle', vol: 0.07, bright: 0.3 })
    note(x, 2093, 0.075, { dur: 0.5, type: 'triangle', vol: 0.07, bright: 0.3 })
  }),
  levelup: () => render(2.5, (x) => {
    swell(x, 130.81, 261.63, 0, 0.7, 0.05)
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(x, f, i * 0.06, { dur: 0.3, type: 'triangle', vol: 0.08, bright: 0.25 }))
    ;[1046.5, 1318.5, 1567.98].forEach((f) => note(x, f, 0.26, { dur: 1.9, vol: 0.055, bright: 0.45 }))
    ;[2093, 2637].forEach((f, i) => note(x, f, 0.34 + i * 0.1, { dur: 1.2, vol: 0.03, bright: 0 }))
  }),
}

// The app's recorded badge sounds (sounds/*.m4a, 0.19), measured once (afconvert to 22.05 kHz mono, the same loudest
// 100 ms): impact -7.7 dB, shine -17.4 dB played at 0.8 (-1.9 dB), equip -15.0 dB.
const RECORDED = { 'badge-impact': -7.7, 'badge-shine': -19.3, 'badge-equip': -15.0 }

// Which of the app's sounds a theme's stands in for. A sound the app has no synth for (the dashboard's pings, the
// theme-only moments) is held to a message's level, a notice's.
const STANDS_FOR = { clash: 'wait', 'ping-waiting': 'wait', rankup: 'levelup' }

const levels = {
  ...Object.fromEntries(Object.entries(APP).map(([name, make]) => [name, loudness(make())])),
  ...Object.fromEntries(Object.entries(RECORDED).map(([name, dB]) => [name, 10 ** (dB / 20)])),
}

/** The loudness (loudest 100 ms, RMS) a theme's sound of `name` is held to: the app's own for that moment. */
export const referenceFor = (name) => levels[name] ?? levels[STANDS_FOR[name]] ?? levels.message
