// Matrix: telephone lines and data, green-screen lo-fi. Each sound: what it is in one line, and how it is made.
import { add, crackle, crush, drive, echo, filter, fm, glide, noise, osc, perc, RATE, reverb, samples, shape, silence, times } from '../dsp.mjs'
import { band, beep, bell, fsk } from '../parts.mjs'

/** An old phone's ring: 440 + 480 Hz under a bell striker's 20 Hz shake, through the line's band. */
function ring(seconds) {
  const tone = add(osc(seconds, 440), osc(seconds, 480))
  const striker = Float64Array.from({ length: samples(seconds) }, (_, i) => 0.62 + 0.38 * Math.sin((2 * Math.PI * 20 * i) / RATE))
  const env = shape(seconds, [[0, 0], [0.012, 1], [seconds - 0.04, 1], [seconds, 0]], 1)
  return times(times(tone, striker), env)
}

export default {
  wait: {
    about: "an old landline's double ring, 440 + 480 Hz under a 20 Hz bell striker, phone-band, a faint crackle on the line",
    make(rng) {
      const d = 1.6
      const out = silence(d)
      for (const at of [0, 0.62]) add(out, ring(0.42), at, 0.5)
      const line = band(out, 300, 3400)
      add(line, filter(noise(d, rng), 'bandpass', 2400, 0.6), 0, 0.01)
      add(line, filter(crackle(d, rng, 16), 'highpass', 1500), 0, 0.22)
      return reverb(drive(line, 1.5), { room: 0.3, wet: 0.12, tail: 0.2 })
    },
  },
  message: {
    about: 'a short modem chirp: a Bell 202 data burst (1200/2200 Hz) and a rising sweep, 8-bit, down a phone line',
    make(rng) {
      const out = silence(0.42)
      add(out, times(fsk(0.19, rng, [1200, 2200], 300), shape(0.19, [[0, 0], [0.004, 1], [0.18, 1], [0.19, 0]], 1)), 0, 0.6)
      add(out, times(osc(0.09, glide(700, 2600, 0.09), { type: 'tri' }), shape(0.09, [[0, 0], [0.005, 1], [0.08, 0.8], [0.09, 0]], 1)), 0.21, 0.5)
      return echo(band(crush(out, 8, 2), 300, 3400), { time: 0.09, feedback: 0.2, wet: 0.22, tail: 0.2 })
    },
  },
  request: {
    about: 'a data handshake: a 2100 Hz answer tone dipping as its phase flips, then a V.21 burst (980/1180 Hz)',
    make(rng) {
      const out = silence(0.5)
      const answer = times(osc(0.16, 2100), shape(0.16, [[0, 0], [0.005, 1], [0.15, 1], [0.16, 0]], 1))
      // The phase flips, every 45 ms, each heard as a short dip.
      const dips = Float64Array.from({ length: answer.length }, (_, i) => {
        const t = (i / RATE) % 0.045
        return t < 0.003 ? 0.15 + 0.85 * Math.abs(t / 0.0015 - 1) : 1
      })
      add(out, times(answer, dips), 0, 0.45)
      add(out, times(fsk(0.2, rng, [980, 1180], 300), shape(0.2, [[0, 0], [0.004, 1], [0.19, 1], [0.2, 0]], 1)), 0.2, 0.55)
      return echo(band(crush(out, 8, 2), 300, 3400), { time: 0.09, feedback: 0.2, wet: 0.2, tail: 0.2 })
    },
  },
  clash: {
    about: 'déjà vu: the same glitchy blip twice, the second 35 cents flat and a shade darker',
    make() {
      const blip = (cents) => {
        const f = 1318.5 * 2 ** (cents / 1200)
        const tone = add(osc(0.13, glide(f * 1.5, f, 0.012), { type: 'square' }), osc(0.13, f * 2.01), 0, 0.3)
        return crush(times(tone, perc(0.13, 0.003, 0.035)), 6, 2)
      }
      const out = silence(0.42)
      add(out, blip(0), 0, 0.5)
      add(out, filter(blip(-35), 'lowpass', 3500), 0.19, 0.45)
      return reverb(out, { room: 0.5, wet: 0.2, tail: 0.25 })
    },
  },
  streak: {
    about: 'a soft rising data shimmer: tiny high sine grains climbing over a swelling band of noise',
    make(rng) {
      const d = 0.95
      const out = silence(d)
      const swell = filter(noise(d, rng), 'bandpass', glide(1200, 5000, 0.8), 2.5)
      add(out, times(swell, shape(d, [[0, 0], [0.55, 1], [d, 0]], 2)), 0, 0.25)
      for (let i = 0; i < 36; i++) {
        const at = rng() * 0.72
        const f = 1400 * 2 ** (at * 2.2) * (1 + (rng() - 0.5) * 0.08)
        add(out, times(osc(0.06, f), perc(0.06, 0.004, 0.015)), at, 0.12 + 0.18 * (at / 0.72))
      }
      return reverb(out, { room: 0.6, wet: 0.3, tail: 0.3 })
    },
  },
  back: {
    about: 'a quiet wake tone: a soft open fifth gliding up out of a low hum, a terminal coming back on',
    make(rng) {
      const d = 0.8
      const env = shape(d, [[0, 0], [0.18, 1], [0.45, 0.7], [d, 0]], 2)
      const tone = add(osc(d, glide(196, 293.66, 0.25)), osc(d, glide(293.66, 440, 0.3)), 0, 0.6)
      add(tone, fm(d, glide(587.33, 880, 0.3), 2, 0.6), 0, 0.2)
      add(tone, beep(0.05, 1760, 'sine', 0.01), 0.3, 0.06)
      const hum = filter(noise(d, rng), 'lowpass', 400)
      return reverb(add(times(tone, env), times(hum, env), 0, 0.12), { room: 0.6, wet: 0.25, tail: 0.3 })
    },
  },
  'badge-equip': {
    about: 'a data lock: a rising modem sweep clicking into a glassy E minor strike at 0.36 s, the app\'s moment',
    make() {
      const out = silence(1.0)
      add(out, times(crush(osc(0.32, glide(400, 2400, 0.32), { type: 'tri' }), 8, 2), shape(0.32, [[0, 0], [0.3, 1], [0.32, 0]], 1)), 0.04, 0.25)
      for (const f of [659.25, 987.77, 1318.51]) add(out, bell(0.6, f, { ratio: 2, index: 1.5, tau: 0.18 }), 0.36, 0.3)
      add(out, crush(times(osc(0.02, 2637), perc(0.02, 0.0005, 0.004)), 6), 0.36, 0.4)
      return reverb(out, { room: 0.55, wet: 0.25, tail: 0.25 })
    },
  },
}
