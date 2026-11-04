#!/usr/bin/env node
/**
 * ika9nt-unlock —— IKA9nt.Encrypter 加密资产包的静态解密器。
 *
 * 目标：`unlock --game <目录>` 一条命令从零解完。**不需要人喂任何参数。**
 *
 * ## 四样东西从哪来（全部静态，不运行游戏）
 *
 * | 需要 | 来源 | 判据（都是会翻脸的那种） |
 * |---|---|---|
 * | `passCharacter` | `global-metadata.dat` 的 string literal 表（**UTF-8**） | 长 150–3000、字符全唯一、只含字母数字+假名 |
 * | `GUID` | `resources.assets` 里 `EncrypterKeyData` 后 512 字节 | 恰好一个 32 位小写十六进制 |
 * | `blocks` | `GameAssembly.dll` 反汇编里对同一地址的连续调用 | 次数 ≥100 **且** 调用点跨度 < 64 KB（全库只有它满足） |
 * | 盐 | 密文的**文件名** | 目录里匹配 /^-?\d+$/ |
 *
 * ## 密码为什么算得出来
 *
 * 生成侧（编辑器 `EncrypterEditor.cs`）：`index = pool.IndexOf(pw[k]) + GUID[k]`，写成 `Substring(index)`。
 * 运行侧（`EncrypterCore.cs`）：`pw[k] = pool[(pool.IndexOf(temp[k]) - GUID[k]) mod 195]`。
 * 因为 `Substring(i)` 只取**一个**字符，`pool.IndexOf(temp[k])` 就是 `i mod 195`。
 *
 * ## 依赖
 *
 * 反汇编 `blocks` 那一步要 `objdump`（binutils）。其余零依赖。
 *
 * @module ika9nt-unlock
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const POOL_MIN = 150, POOL_MAX = 3000
const SUBSTRING_MAX_SPAN = 0x10000 // 64 KB：Substring 的调用点挤在一个函数里，别的不行
const ARRAY_NEW = '0x180202df0'    // 只在 --emit-blocks 内部用，见 detectSubstring

// ── 基础 ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const k = a.slice(2)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) out[k] = true
    else { out[k] = v; i++ }
  }
  return out
}

function walk(dir, depth = 0, acc = []) {
  if (depth > 6) return acc
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1, acc)
    else acc.push(p)
  }
  return acc
}

// ── 一、passCharacter ───────────────────────────────────────────────────────

export function findPassCharacter(metadataPath) {
  const b = fs.readFileSync(metadataPath)
  const magic = b.readUInt32LE(0)
  if (magic !== 0xfab11baf) throw new Error(`不是 IL2CPP metadata（magic=0x${magic.toString(16)}）`)
  const version = b.readInt32LE(4)
  const litOff = b.readUInt32LE(8), litSize = b.readUInt32LE(12)
  const dataOff = b.readUInt32LE(16)
  const count = Math.floor(litSize / 8)
  const cands = []
  for (let i = 0; i < count; i++) {
    const len = b.readUInt32LE(litOff + i * 8)
    const di = b.readInt32LE(litOff + i * 8 + 4)
    if (len < POOL_MIN || len > POOL_MAX) continue
    const raw = b.subarray(dataOff + di, dataOff + di + len)
    if (raw.length !== len) continue
    const s = raw.toString('utf8')
    const chars = [...s]
    // ⚠️ 不能比 chars.length === len：len 是 UTF-8 **字节数**，假名占 3 字节。
    if (new Set(chars).size !== chars.length) continue
    if (!/^[0-9a-zA-Z\u3040-\u30ff\uff66-\uff9f]+$/.test(s)) continue
    cands.push({ index: i, value: s })
  }
  if (cands.length === 0) throw new Error('没找到字符池：判据一条都不中')
  cands.sort((a, b) => b.value.length - a.value.length)
  return { version, candidates: cands, chosen: cands[0] }
}

// ── 二、GUID ────────────────────────────────────────────────────────────────

export function findGuid(assetsPath, window = 512) {
  const b = fs.readFileSync(assetsPath)
  const at = b.indexOf(Buffer.from('EncrypterKeyData', 'utf8'))
  if (at < 0) throw new Error('resources.assets 里没有 EncrypterKeyData')
  const seg = b.subarray(Math.max(0, at - 64), at + window).toString('latin1')
  const hits = [...new Set([...seg.matchAll(/[0-9a-f]{32}/g)].map(m => m[0]))]
  if (hits.length !== 1) throw new Error(`GUID 判据失败：窗口内 ${hits.length} 个 32-hex（要求恰好 1）`)
  return { guid: hits[0], offset: at }
}

// ── 三、blocks（反汇编）─────────────────────────────────────────────────────

/** 跑 objdump 全量反汇编到临时文件，返回行数组。 */
function disassemble(dllPath) {
  const tmp = path.join('/tmp', `ika9nt-asm-${process.pid}.txt`)
  execFileSync('objdump', ['-d', dllPath], { stdio: ['ignore', fs.openSync(tmp, 'w'), 'ignore'], maxBuffer: 1 << 30 })
  return fs.readFileSync(tmp, 'utf8').split('\n')
}

/**
 * 找出 `Substring`：全库反复被 `mov $imm,%edx` + `call` 调用的目标里，
 * **次数够多、调用点又全挤在一小段地址内**的那一个。
 */
export function detectSubstring(lines) {
  const sites = new Map()
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+([0-9a-f]+):.*call\s+(0x[0-9a-f]+)/)
    if (!m) continue
    let hasImm = false
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      if (/mov\s+\$0x[0-9a-f]+,%edx/.test(lines[j])) { hasImm = true; break }
    }
    if (!hasImm) continue
    if (!sites.has(m[2])) sites.set(m[2], [])
    sites.get(m[2]).push(parseInt(m[1], 16))
  }
  const rows = []
  for (const [t, addrs] of sites) {
    if (addrs.length < 100) continue
    const span = Math.max(...addrs) - Math.min(...addrs)
    if (span > SUBSTRING_MAX_SPAN) continue
    rows.push({ target: t, count: addrs.length, span })
  }
  if (rows.length !== 1) throw new Error(`Substring 判据失败：命中 ${rows.length} 个候选（要求恰好 1）`)
  return rows[0]
}

/** 把 Substring 的调用点按 Array::new 切成组，返回每组的偏移数组。 */
export function extractBlocks(lines, substringAddr) {
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`call\\s+${substringAddr}\\b`).test(lines[i])) continue
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const m = lines[j].match(/mov\s+\$0x([0-9a-f]+),%edx/)
      if (m) { hits.push({ line: i, off: parseInt(m[1], 16) }); break }
    }
  }
  const groups = []
  let cur = []
  let lastLine = -1
  for (const h of hits) {
    let boundary = false
    for (let j = Math.max(lastLine + 1, h.line - 60); j < h.line; j++) {
      if (new RegExp(`call\\s+${ARRAY_NEW}\\b`).test(lines[j])) { boundary = true; break }
    }
    if (boundary && cur.length) { groups.push(cur); cur = [] }
    cur.push(h.off)
    lastLine = h.line
  }
  if (cur.length) groups.push(cur)
  return groups
}

// ── 四、密码与解密 ──────────────────────────────────────────────────────────

export function passwordFromBlock(block, passCharacter, guid) {
  let p = ''
  for (let i = 0; i < block.length; i++) {
    const digit = parseInt(guid[i], 16)
    if (Number.isNaN(digit)) throw new Error(`GUID 第 ${i} 位不是十六进制`)
    const n = passCharacter.length
    p += passCharacter[(((block[i] % n) - digit) % n + n) % n]
  }
  return p
}

export function makeCipher(password, hash) {
  const key = crypto.pbkdf2Sync(Buffer.from(password.trim(), 'utf8'), Buffer.from(String(hash), 'utf8'), 1000, 32, 'sha1')
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null)
  cipher.setAutoPadding(false)
  const nonce = Buffer.alloc(16)
  return (buf, pos) => {
    const out = Buffer.allocUnsafe(buf.length)
    for (let off = 0; off < buf.length; off += 16) {
      nonce.fill(0)
      nonce.writeBigInt64LE(BigInt(Math.floor((pos + off) / 16) + 1), 0)
      const ks = cipher.update(nonce)
      const len = Math.min(16, buf.length - off)
      for (let j = 0; j < len; j++) out[off + j] = buf[off + j] ^ ks[j]
    }
    return out
  }
}

export function decryptFile(src, dst, password, hash, chunk = 1 << 20) {
  const fd = fs.openSync(src, 'r')
  const out = fs.openSync(dst, 'w')
  const buf = Buffer.allocUnsafe(chunk)
  let pos = 0
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunk, pos)
      if (n === 0) break
      fs.writeSync(out, makeCipher(password, hash)(n === chunk ? buf : buf.subarray(0, n), pos))
      pos += n
    }
  } finally { fs.closeSync(fd); fs.closeSync(out) }
  return pos
}

// ── 五、Unpack：从 UnityFS 里取一个文件 ─────────────────────────────────────

function lz4(src, dstSize) {
  const dst = Buffer.allocUnsafe(dstSize)
  let i = 0, o = 0
  while (i < src.length) {
    const token = src[i++]
    let lit = token >> 4
    if (lit === 15) { let b; do { b = src[i++]; lit += b } while (b === 255) }
    if (lit) { src.copy(dst, o, i, i + lit); i += lit; o += lit }
    if (i >= src.length) break
    const off = src[i] | (src[i + 1] << 8); i += 2
    let ml = token & 0x0f
    if (ml === 15) { let b; do { b = src[i++]; ml += b } while (b === 255) }
    ml += 4
    const start = o - off
    for (let k = 0; k < ml; k++) dst[o++] = dst[start + k]
  }
  if (o !== dstSize) throw new Error(`lz4 ${o} != ${dstSize}`)
  return dst
}

export function unpackFile(archivePath, wantName, outPath) {
  const fd = fs.openSync(archivePath, 'r')
  try {
    const head = Buffer.alloc(64)
    fs.readSync(fd, head, 0, 64, 0)
    if (head.toString('latin1', 0, 7) !== 'UnityFS') throw new Error('不是 UnityFS')
    let q = 12
    q = head.indexOf(0, q) + 1
    q = head.indexOf(0, q) + 1
    q += 8
    const csize = head.readUInt32BE(q), usize = head.readUInt32BE(q + 4)
    q += 12
    q = (q + 15) & ~15
    const info = Buffer.alloc(csize)
    fs.readSync(fd, info, 0, csize, q)
    const raw = lz4(info, usize)
    let p = 16
    const nblk = raw.readUInt32BE(p); p += 4
    const blocks = []
    for (let i = 0; i < nblk; i++) {
      blocks.push({ u: raw.readUInt32BE(p), c: raw.readUInt32BE(p + 4) })
      p += 10
    }
    const nfile = raw.readUInt32BE(p); p += 4
    const files = []
    for (let i = 0; i < nfile; i++) {
      const off = Number(raw.readBigInt64BE(p)); p += 8
      const sz = Number(raw.readBigInt64BE(p)); p += 8
      p += 4
      const e = raw.indexOf(0, p)
      files.push({ off, sz, name: raw.toString('latin1', p, e) })
      p = e + 1
    }
    const target = files.find(f => f.name === wantName) || files.find(f => f.name.includes(wantName))
    if (!target) throw new Error(`目录里没有 ${wantName}`)
    const dataStart = ((q + csize) + 15) & ~15
    const tStart = target.off, tEnd = target.off + target.sz
    const out = fs.openSync(outPath, 'w')
    let pos = 0, done = 0, readPos = dataStart
    try {
      for (const b of blocks) {
        const bStart = pos, bEnd = pos + b.u
        pos = bEnd
        const comp = Buffer.alloc(b.c)
        fs.readSync(fd, comp, 0, b.c, readPos)
        readPos += b.c
        if (bEnd <= tStart || bStart >= tEnd) continue
        const plain = lz4(comp, b.u)
        const lo = Math.max(tStart, bStart) - bStart
        const hi = Math.min(tEnd, bEnd) - bStart
        fs.writeSync(out, plain.subarray(lo, hi))
        done += hi - lo
        if (done >= target.sz) break
      }
    } finally { fs.closeSync(out) }
    return { written: done, expected: target.sz, name: target.name }
  } finally { fs.closeSync(fd) }
}

// ── 六、命令 ────────────────────────────────────────────────────────────────

function cmdScan(args) {
  const game = args.game || '.'
  const files = walk(game)
  const md = files.find(f => f.endsWith('global-metadata.dat'))
  const ga = files.find(f => /GameAssembly\.dll$/i.test(f))
  const assets = files.find(f => /resources\.assets$/.test(f))
  console.log(`游戏目录: ${game}`)
  console.log(`  metadata: ${md ? '✓' : '✗'}  GameAssembly: ${ga ? '✓' : '✗'}  resources.assets: ${assets ? '✓' : '✗ (需先 unpack)'}`)
  if (md) {
    const r = findPassCharacter(md)
    console.log(`  passCharacter: 候选 ${r.candidates.length}，选中 len=${r.chosen.value.length}`)
  }
  if (assets) console.log(`  GUID: ${findGuid(assets).guid}`)
}

function cmdUnlock(args) {
  const game = args.game || '.'
  const out = args.out || path.join(game, 'decrypted')
  const saDir = args.sa || findStreamingAssets(game)
  if (!saDir) { console.error('找不到 StreamingAssets/StandaloneWindows64'); process.exit(2) }
  console.log(`游戏: ${game}\nStreamingAssets: ${saDir}\n输出: ${out}`)

  // 1. metadata → passCharacter
  const md = walk(game).find(f => f.endsWith('global-metadata.dat'))
  if (!md) { console.error('找不到 global-metadata.dat'); process.exit(2) }
  const pc = findPassCharacter(md)
  console.log(`  [1/4] passCharacter len=${pc.chosen.value.length}`)

  // 2. data.unity3d → resources.assets → GUID
  let assets = walk(game).find(f => /resources\.assets$/.test(f))
  if (!assets) {
    const du = walk(game).find(f => f.endsWith('data.unity3d'))
    if (!du) { console.error('找不到 resources.assets 也没有 data.unity3d'); process.exit(2) }
    const tmpAssets = path.join('/tmp', `ika9nt-assets-${process.pid}.bin`)
    const r = unpackFile(du, 'resources.assets', tmpAssets)
    console.log(`  [2/4] 从 data.unity3d 提出 resources.assets (${r.written.toLocaleString()})`)
    assets = tmpAssets
  }
  const g = findGuid(assets)
  console.log(`  [3/4] GUID ${g.guid}`)

  // 3. GameAssembly → blocks
  const ga = walk(game).find(f => /GameAssembly\.dll$/i.test(f))
  if (!ga) { console.error('找不到 GameAssembly.dll'); process.exit(2) }
  const lines = disassemble(ga)
  const sub = detectSubstring(lines)
  const blocks = extractBlocks(lines, sub.target)
  console.log(`  [3/4] Substring=${sub.target}（${sub.count} 次，跨度 0x${sub.span.toString(16)}），切成 ${blocks.length} 组`)
  const passwords = blocks.map(b => passwordFromBlock(b, pc.chosen.value, g.guid))

  // 4. 解密并配对
  fs.mkdirSync(out, { recursive: true })
  let ok = 0, skipped = 0
  for (const f of fs.readdirSync(saDir).filter(f => /^-?\d+$/.test(f))) {
    const src = path.join(saDir, f)
    const head = Buffer.alloc(16)
    const fd = fs.openSync(src, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd)
    const pw = passwords.find(p => makeCipher(p, f)(head, 0).toString('latin1', 0, 5) === 'Unity')
    if (!pw) { console.log(`  ✗ ${f} 无密码可解`); skipped++; continue }
    const n = decryptFile(src, path.join(out, f), pw, f)
    console.log(`  ✓ ${f} → ${n.toLocaleString()} 字节`)
    ok++
  }
  console.log(`\n[4/4] 解出 ${ok}，跳过 ${skipped}。`)
  if (skipped) process.exitCode = 1
}

function findStreamingAssets(game) {
  const hit = walk(game).filter(f => /StreamingAssets[\\/]StandaloneWindows64$/i.test(path.dirname(f)))
  return hit.length ? path.dirname(hit[0]) : null
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
if (cmd === 'scan') cmdScan(args)
else if (cmd === 'unlock') cmdUnlock(args)
else {
  console.log('用法：')
  console.log('  node ika9nt-unlock.mjs scan   --game <游戏目录>')
  console.log('  node ika9nt-unlock.mjs unlock --game <游戏目录> [--out <输出>] [--sa <StreamingAssets>]')
  process.exit(2)
}
