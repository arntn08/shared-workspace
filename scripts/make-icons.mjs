import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const table = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  table[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      const p = pixel(x / size, y / size)
      raw[o++] = p[0]
      raw[o++] = p[1]
      raw[o++] = p[2]
      raw[o++] = p[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const mix = (a, b, t) => a + (b - a) * t
const teal = [169, 214, 214]
const lime = [214, 242, 107]

function icon(u, v) {
  const dx = u - 0.5
  const dy = (v - 0.52) * 1.5
  const d = Math.sqrt(dx * dx + dy * dy)
  let r = 11 + 14 * (1 - v)
  let g = 13 + 18 * (1 - v)
  let b = 16 + 22 * (1 - v)
  if (d < 0.36 && d > 0.07) {
    const f = (d * 16) % 1
    if (f < 0.16) {
      const t = 1 - d / 0.36
      r = mix(r, mix(teal[0], lime[0], t), 0.9)
      g = mix(g, mix(teal[1], lime[1], t), 0.9)
      b = mix(b, mix(teal[2], lime[2], t), 0.9)
    }
  }
  if (d < 0.075) {
    r = lime[0]
    g = lime[1]
    b = lime[2]
  } else if (d < 0.14) {
    const t = (1 - (d - 0.075) / 0.065) * 0.35
    r = mix(r, lime[0], t)
    g = mix(g, lime[1], t)
    b = mix(b, lime[2], t)
  }
  return [Math.round(r), Math.round(g), Math.round(b), 255]
}

try {
  mkdirSync('public', { recursive: true })
  writeFileSync('public/icon-192.png', png(192, icon))
  writeFileSync('public/icon-512.png', png(512, icon))
  writeFileSync('public/apple-touch-icon.png', png(180, icon))
  console.log('Icons created')
} catch (e) {
  console.log('Icon generation skipped:', e && e.message)
}
