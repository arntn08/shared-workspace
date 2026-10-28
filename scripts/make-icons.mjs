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
      const p = pixel((x + .5) / size, (y + .5) / size)
      raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}
const insideRoundRect = (x, y, l, t, r, b, rad) => {
  const cx = Math.max(l + rad, Math.min(x, r - rad))
  const cy = Math.max(t + rad, Math.min(y, b - rad))
  return (x-cx)**2 + (y-cy)**2 <= rad**2
}
const polygon = (x, y, pts) => {
  let inside = false
  for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
    const [xi,yi]=pts[i], [xj,yj]=pts[j]
    if (((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside
  }
  return inside
}
function icon(x, y) {
  const bg = [19, 86, 53, 255]
  const greenLight = [42, 133, 79, 255]
  const white = [255, 255, 249, 255]
  const gold = [211, 177, 93, 255]
  if (!insideRoundRect(x,y,.04,.04,.96,.96,.19)) return [0,0,0,0]
  let color = bg
  if (insideRoundRect(x,y,.07,.07,.93,.93,.16)) color = greenLight
  // restrained double-line corporate shield
  const shield = [[.5,.19],[.76,.29],[.73,.59],[.5,.79],[.27,.59],[.24,.29]]
  const shieldInner = [[.5,.235],[.715,.315],[.69,.565],[.5,.735],[.31,.565],[.285,.315]]
  if (polygon(x,y,shield)) color = gold
  if (polygon(x,y,shieldInner)) color = white
  // geometric A monogram, deliberately bold and legible at small sizes
  const outerA = polygon(x,y,[[.5,.31],[.69,.63],[.62,.63],[.57,.54],[.43,.54],[.38,.63],[.31,.63]])
  const cutout = polygon(x,y,[[.5,.405],[.545,.49],[.455,.49]])
  if (outerA && !cutout) color = bg
  // subtle baseline for a polished identity mark
  if (x>.39 && x<.61 && y>.665 && y<.69) color = gold
  return color
}
try {
  mkdirSync('public', { recursive: true })
  writeFileSync('public/icon-192.png', png(192, icon))
  writeFileSync('public/icon-512.png', png(512, icon))
  writeFileSync('public/apple-touch-icon.png', png(180, icon))
  console.log('Formal corporate icons created')
} catch (e) {
  console.error('Icon generation failed:', e && e.message)
  process.exitCode = 1
}
