// WAV files: the 16-bit PCM mono writer the sound generator uses, and the reader the checker uses on any pack file.

/** A WAV file of 16-bit PCM mono samples (-1..1, clipped), as bytes. */
export function encodeWav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'ascii')
  head.write('fmt ', 12, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** The chunks of a RIFF/WAVE file, by id (the first of each), or null when it isn't one. */
function chunks(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  const found = {}
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    found[id] ??= { at: at + 8, size }
    at += 8 + size + (size % 2)
  }
  return found
}

/** What keeps a file from being a WAV the app plays as it is (PCM, mono or stereo); [] when nothing does. */
export function wavErrors(buf) {
  const found = chunks(buf)
  if (!found) return ['not a RIFF/WAVE file']
  if (!found['fmt '] || found['fmt '].size < 16 || found['fmt '].at + 16 > buf.length) return ['has no fmt chunk']
  const fmt = found['fmt '].at
  const format = buf.readUInt16LE(fmt)
  const channels = buf.readUInt16LE(fmt + 2)
  const bits = buf.readUInt16LE(fmt + 14)
  if (format !== 1) return [`not PCM (format ${format})`]
  const errors = []
  if (channels !== 1 && channels !== 2) errors.push(`has ${channels} channels, not mono or stereo`)
  if (![8, 16, 24].includes(bits)) errors.push(`has ${bits}-bit samples, not 8, 16 or 24`)
  if (buf.readUInt16LE(fmt + 12) !== (channels * bits) / 8) errors.push('its block size does not match its channels and bits')
  if (errors.length) return errors
  const data = found.data
  if (!data) return ['has no data chunk']
  if (data.at + data.size > buf.length) return ['its data runs past the end of the file']
  if (data.size === 0) return ['has no samples']
  return []
}
