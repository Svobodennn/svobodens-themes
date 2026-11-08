// The sound generator's building blocks: oscillators, envelopes, filters, noise, echo, reverb and bit-crush over
// Float64Array buffers at one sample rate, and the finishing steps every sound goes through. No dependencies; every
// random choice comes from a seeded PRNG, so a sound is the same bytes on every run.
// The buffers are filled in place: these are sample arrays, not shared state.

export const RATE = 22050
export const samples = (seconds) => Math.max(0, Math.round(seconds * RATE))

/** mulberry32: a small seeded PRNG giving 0..1. */
export function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a of a string: a sound's seed from its name, so adding a sound never changes another. */
export function seedOf(text) {
  let h = 0x811c9dc5
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return h >>> 0
}

const fn = (v) => (typeof v === 'function' ? v : () => v)

/** An exponential glide from f0 to f1 over `seconds`, then held: a frequency for osc(). */
export const glide = (f0, f1, seconds) => (t) => f0 * (f1 / f0) ** Math.min(1, t / seconds)

// PolyBLEP: rounds the steps of a saw or square off over one sample, so they don't alias into a hiss.
function blep(t, dt) {
  if (t < dt) {
    const k = t / dt
    return k + k - k * k - 1
  }
  if (t > 1 - dt) {
    const k = (t - 1) / dt
    return k * k + k + k + 1
  }
  return 0
}

function wave(type, p, dt) {
  if (type === 'sine') return Math.sin(2 * Math.PI * p)
  if (type === 'tri') return 4 * Math.abs(p - 0.5) - 1
  if (type === 'saw') return 2 * p - 1 - blep(p, dt)
  if (type === 'square') return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt)
  throw new Error(`no wave "${type}"`)
}

/** An oscillator `seconds` long: `freq` in Hz or a function of time (s); sine, tri, saw or square. Sine starts at 0. */
export function osc(seconds, freq, { type = 'sine', phase = 0 } = {}) {
  const f = fn(freq)
  const out = new Float64Array(samples(seconds))
  let p = phase
  for (let i = 0; i < out.length; i++) {
    const dt = f(i / RATE) / RATE
    out[i] = wave(type, p, dt)
    p = (p + dt) % 1
  }
  return out
}

/** A two-operator FM tone: carrier `freq`, modulator at freq × ratio, `index` (radians, or a function of time). */
export function fm(seconds, freq, ratio, index) {
  const f = fn(freq)
  const k = fn(index)
  const out = new Float64Array(samples(seconds))
  let pc = 0
  let pm = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    out[i] = Math.sin(2 * Math.PI * pc + k(t) * Math.sin(2 * Math.PI * pm))
    pc = (pc + f(t) / RATE) % 1
    pm = (pm + (f(t) * ratio) / RATE) % 1
  }
  return out
}

/** White noise, -1..1. */
export const noise = (seconds, rng) => Float64Array.from({ length: samples(seconds) }, () => rng() * 2 - 1)

/** An envelope through [time s, level] points: a linear rise, a falling segment curved like a decay (`curve`, 1 is a
 *  straight line), held at the last level. */
export function shape(seconds, points, curve = 3) {
  const out = new Float64Array(samples(seconds))
  let seg = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    while (seg < points.length - 1 && t >= points[seg + 1][0]) seg++
    if (seg >= points.length - 1) {
      out[i] = points[points.length - 1][1]
      continue
    }
    const [t0, a] = points[seg]
    const [t1, b] = points[seg + 1]
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1
    out[i] = b >= a ? a + (b - a) * k : b + (a - b) * (1 - k) ** curve
  }
  return out
}

/** A percussive envelope: a linear attack, then an exponential decay with time constant `tau`, `seconds` long, tapering
 *  to 0 over its last 15 ms (a decay cut off mid-way is a click). */
export function perc(seconds, attack, tau) {
  const n = samples(seconds)
  const taper = Math.min(samples(0.015), Math.floor(n / 4))
  return Float64Array.from({ length: n }, (_, i) => {
    const t = i / RATE
    const tail = taper > 0 && i > n - 1 - taper ? (n - 1 - i) / taper : 1
    return (t < attack ? t / attack : Math.exp(-(t - attack) / tau)) * tail
  })
}

/** x times a gain, or times an envelope sample by sample (silence past the envelope's end). */
export function times(x, g) {
  if (typeof g === 'number') return x.map((v) => v * g)
  return x.map((v, i) => v * (g[i] ?? 0))
}

/** Adds `src` into `dst` from `at` seconds, times `gain` (what runs past dst's end is dropped). */
export function add(dst, src, at = 0, gain = 1) {
  const o = samples(at)
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain
  return dst
}

/** A silent buffer. */
export const silence = (seconds) => new Float64Array(samples(seconds))

/** A biquad (RBJ cookbook): lowpass, highpass or bandpass (0 dB peak), cutoff in Hz or a function of time. */
export function filter(x, type, freq, q = Math.SQRT1_2) {
  const f = fn(freq)
  const out = new Float64Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let c = null
  for (let i = 0; i < x.length; i++) {
    if (i % 16 === 0) {
      const w = (2 * Math.PI * Math.min(Math.max(f(i / RATE), 10), RATE * 0.45)) / RATE
      const cs = Math.cos(w)
      const al = Math.sin(w) / (2 * q)
      const a0 = 1 + al
      const b = type === 'lowpass' ? [(1 - cs) / 2, 1 - cs, (1 - cs) / 2] : type === 'highpass' ? [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2] : [al, 0, -al]
      c = { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cs) / a0, a2: (1 - al) / a0 }
    }
    const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/** A feedback echo, as the app's own sounds have (sfx.js: 0.13 s, feedback 0.28, wet 0.3), ringing `tail` s past x. */
export function echo(x, { time = 0.13, feedback = 0.28, wet = 0.3, tail = 0.4 } = {}) {
  const d = samples(time)
  const out = new Float64Array(x.length + samples(tail))
  const loop = new Float64Array(out.length)
  for (let i = 0; i < out.length; i++) {
    const dry = x[i] ?? 0
    loop[i] = i >= d ? (x[i - d] ?? 0) + feedback * loop[i - d] : 0
    out[i] = dry + wet * loop[i]
  }
  return out
}

/** A small Schroeder reverb (parallel damped combs, then allpasses), ringing `tail` s past x. */
export function reverb(x, { room = 0.6, damp = 0.4, wet = 0.25, tail = 0.5 } = {}) {
  const n = x.length + samples(tail)
  const scale = RATE / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => ({ buf: new Float64Array(Math.round(d * scale)), i: 0, low: 0 }))
  const passes = [556, 441, 341].map((d) => ({ buf: new Float64Array(Math.round(d * scale)), i: 0 }))
  const fb = 0.7 + 0.28 * room
  const out = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const dry = x[k] ?? 0
    let s = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.low = y * (1 - damp) + c.low * damp
      c.buf[c.i] = dry * 0.12 + c.low * fb
      c.i = (c.i + 1) % c.buf.length
      s += y
    }
    for (const a of passes) {
      const b = a.buf[a.i]
      a.buf[a.i] = s + b * 0.5
      a.i = (a.i + 1) % a.buf.length
      s = b - s
    }
    out[k] = dry + wet * s
  }
  return out
}

/** Bit-crush: `bits` of resolution, each value held for `hold` samples (a lower sample rate's grit). */
export function crush(x, bits, hold = 1) {
  const step = 2 / 2 ** bits
  let held = 0
  return x.map((v, i) => {
    if (i % hold === 0) held = Math.round(v / step) * step
    return held
  })
}

/** Soft saturation: tanh, gain-matched at small levels. */
export const drive = (x, amount) => x.map((v) => Math.tanh(v * amount) / amount)

/** Sparse crackle: random clicks, `perSecond` on average, each a few samples of decaying noise. */
export function crackle(seconds, rng, perSecond, level = 1) {
  const out = silence(seconds)
  for (let i = 0; i < out.length; i++) {
    if (rng() >= perSecond / RATE) continue
    const amp = level * (0.3 + 0.7 * rng()) * (rng() < 0.5 ? -1 : 1)
    const n = 2 + Math.floor(rng() * 6)
    for (let k = 0; k < n && i + k < out.length; k++) out[i + k] += amp * Math.exp(-k / 1.5) * (k % 2 ? -0.6 : 1)
  }
  return out
}

// ---------------------------------------------------------------- measuring and finishing

export const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** The loudest 100 ms, as RMS: a short sound's loudness, close to what the ear takes from it. */
export function loudness(x) {
  const w = Math.round(RATE / 10)
  let sum = 0
  let loudest = 0
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i] - (i >= w ? x[i - w] * x[i - w] : 0)
    loudest = Math.max(loudest, sum)
  }
  return Math.sqrt(loudest / w)
}

/** x without its trailing near-silence (below `floor` of its peak), keeping `keep` s after the last loud sample. */
export function trim(x, floor = 0.002, keep = 0.03) {
  const limit = peakOf(x) * floor
  let last = x.length - 1
  while (last > 0 && Math.abs(x[last]) < limit) last--
  return x.slice(0, Math.min(x.length, last + 1 + samples(keep)))
}

/** x without a DC offset: a 10 Hz high-pass, then its mean taken off. */
export function centre(x) {
  const r = 1 - (2 * Math.PI * 10) / RATE
  let px = 0
  let py = 0
  const hp = x.map((v) => {
    py = v - px + r * py
    px = v
    return py
  })
  const mean = hp.reduce((s, v) => s + v, 0) / hp.length
  return hp.map((v) => v - mean)
}

/** Raised-cosine fades over the first `fadeIn` and the last `fadeOut` seconds, so both ends start and stop at 0. */
export function fade(x, fadeIn = 0.006, fadeOut = 0.03) {
  const a = Math.max(1, samples(fadeIn))
  const b = Math.max(1, samples(fadeOut))
  const n = x.length
  return x.map((v, i) => {
    const up = i < a ? (1 - Math.cos((Math.PI * i) / a)) / 2 : 1
    const down = i > n - 1 - b ? (1 - Math.cos((Math.PI * (n - 1 - i)) / b)) / 2 : 1
    return v * up * down
  })
}
