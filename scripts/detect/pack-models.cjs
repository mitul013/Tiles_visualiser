/**
 * Split the detection models into parts small enough for any static host (and for git), and write
 * public/models/manifest.json:
 *   node scripts/detect/pack-models.cjs <room-seg.onnx> <room-depth.onnx>
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const [seg, depth] = process.argv.slice(2)
if (!seg || !depth) {
  console.error('usage: node scripts/detect/pack-models.cjs <room-seg.onnx> <room-depth.onnx>')
  process.exit(1)
}
const out = path.join(__dirname, '..', '..', 'public', 'models')
fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(out)) if (/\.part\d+$|manifest\.json$/.test(f)) fs.unlinkSync(path.join(out, f))
const PART = 19 * 1024 * 1024
const hash = crypto.createHash('sha256')
const models = {}
for (const [key, file] of [['seg', seg], ['depth', depth]]) {
  const buf = fs.readFileSync(file)
  hash.update(buf)
  const parts = []
  for (let off = 0, i = 0; off < buf.length; off += PART, i++) {
    const name = `room-${key}.onnx.part${i}`
    fs.writeFileSync(path.join(out, name), buf.subarray(off, off + PART))
    parts.push(name)
  }
  models[key] = { parts, bytes: buf.length }
  console.log(`${key}: ${(buf.length / 1e6).toFixed(1)} MB in ${parts.length} parts`)
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), models }, null, 1))
