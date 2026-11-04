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

// ── 零、多语言 ──────────────────────────────────────────────────────────────
//
// 语言按运行环境自动识别，顺序：`--lang` > `IKA9NT_LANG` > 系统 locale > 英文。
// 只翻译给人看的进度输出；JSON、字段名、路径、错误码一律不译。

const MESSAGES = {
  zh: {
    game: '游戏',
    sa: 'StreamingAssets',
    out: '输出',
    step1: (n) => `  [1/4] passCharacter len=${n}`,
    step2: (n) => `  [2/4] 从 data.unity3d 提出 resources.assets (${n})`,
    step3: (g, n) => `  [3/4] GUID ${g}，${n} 个 label`,
    step3b: (t, c, sp, n) => `  [3/4] Substring=${t}（${c} 次，跨度 0x${sp}），切成 ${n} 组`,
    step3arek: (f, n) => `  [3/4] 从 ${f} 读到 ${n} 个密码（跳过反汇编）`,
    ok: (h, label, n, how) => `  ✓ ${h}${label ? ` [${label}]` : ''} → ${n} 字节${how === 'trial' ? '（试错匹配）' : ''}`,
    skip: (h) => `  ✗ ${h} 没有密码能解出 UnityFS 头`,
    done: (ok, skip) => `\n[4/4] 解出 ${ok}，跳过 ${skip}。`,
    arekOut: (f, n) => `  AREK.txt 已写到 ${f}（${n} 条，含明文密码）`,
    skipNote: '\n跳过说明：判据是解出来的头必须是 `UnityFS`，解错会跳过而不是产出垃圾。',
    noneOk: '一个都没解出来，可能是加密器版本变了（例如 salt 不再等于文件名）。',
    noneOk2: '用仓库 README 里「新旧加密包的对照」一节比对，或到仓库开 issue 附上游戏名与版本。',
    arekStale: '  提示：AREK.txt 里的密码是版本相关的；如果来自别的版本，这里会全部解不出来。',
    noSA: '找不到 StreamingAssets/StandaloneWindows64',
    noMD: '找不到 global-metadata.dat',
    noAssets: '找不到 resources.assets 也没有 data.unity3d',
    noGA: '找不到 GameAssembly.dll',
    usage: '用法：',
    usageScan: '  node ika9nt-unlock.mjs scan   --game <游戏目录>',
    usageUnlock: '  node ika9nt-unlock.mjs unlock --game <游戏目录> [--out <输出>] [--sa <StreamingAssets>] [--arek-in <路径>] [--arek-out <路径>]',
    scanHead: (g) => `游戏目录: ${g}`,
    scanFound: (md, ga, as) => `  metadata: ${md ? '✓' : '✗'}  GameAssembly: ${ga ? '✓' : '✗'}  resources.assets: ${as ? '✓' : '✗（需先 unpack）'}`,
    scanPool: (c, n) => `  passCharacter: 候选 ${c}，选中 len=${n}`,
    scanGuid: (g) => `  GUID: ${g}`,
    apiHint: '见 README「原理」一节',
  },
  en: {
    game: 'game',
    sa: 'StreamingAssets',
    out: 'output',
    step1: (n) => `  [1/4] passCharacter len=${n}`,
    step2: (n) => `  [2/4] extracted resources.assets from data.unity3d (${n})`,
    step3: (g, n) => `  [3/4] GUID ${g}, ${n} labels`,
    step3b: (t, c, sp, n) => `  [3/4] Substring=${t} (${c} calls, span 0x${sp}), split into ${n} groups`,
    step3arek: (f, n) => `  [3/4] read ${n} passwords from ${f} (disassembly skipped)`,
    ok: (h, label, n, how) => `  ✓ ${h}${label ? ` [${label}]` : ''} → ${n} bytes${how === 'trial' ? ' (trial match)' : ''}`,
    skip: (h) => `  ✗ ${h}: no password yields a UnityFS header`,
    done: (ok, skip) => `\n[4/4] decrypted ${ok}, skipped ${skip}.`,
    arekOut: (f, n) => `  AREK.txt written to ${f} (${n} entries, plaintext passwords)`,
    skipNote: '\nNote: the criterion is that the decrypted header must be `UnityFS`; a wrong password is skipped rather than written out as garbage.',
    noneOk: 'Nothing decrypted — the encryptor version may have changed (e.g. salt is no longer the filename).',
    noneOk2: 'Compare against the "Old vs. new packages" section in the README, or open an issue with the game name and version.',
    arekStale: '  Note: passwords in AREK.txt are version-specific; from a different build, they will all fail here.',
    noSA: 'StreamingAssets/StandaloneWindows64 not found',
    noMD: 'global-metadata.dat not found',
    noAssets: 'neither resources.assets nor data.unity3d found',
    noGA: 'GameAssembly.dll not found',
    usage: 'Usage:',
    usageScan: '  node ika9nt-unlock.mjs scan   --game <game dir>',
    usageUnlock: '  node ika9nt-unlock.mjs unlock --game <game dir> [--out <dir>] [--sa <StreamingAssets>] [--arek-in <path>] [--arek-out <path>]',
    scanHead: (g) => `game dir: ${g}`,
    scanFound: (md, ga, as) => `  metadata: ${md ? '✓' : '✗'}  GameAssembly: ${ga ? '✓' : '✗'}  resources.assets: ${as ? '✓' : '✗ (unpack first)'}`,
    scanPool: (c, n) => `  passCharacter: ${c} candidate(s), chosen len=${n}`,
    scanGuid: (g) => `  GUID: ${g}`,
    apiHint: 'see the "How it works" section in the README',
  },
  ja: {
    game: 'ゲーム',
    sa: 'StreamingAssets',
    out: '出力',
    step1: (n) => `  [1/4] passCharacter len=${n}`,
    step2: (n) => `  [2/4] data.unity3d から resources.assets を抽出 (${n})`,
    step3: (g, n) => `  [3/4] GUID ${g}、${n} 個の label`,
    step3b: (t, c, sp, n) => `  [3/4] Substring=${t}（${c} 回、跨度 0x${sp}）、${n} グループに分割`,
    step3arek: (f, n) => `  [3/4] ${f} から ${n} 個のパスワードを読み込み（逆アセンブルを省略）`,
    ok: (h, label, n, how) => `  ✓ ${h}${label ? ` [${label}]` : ''} → ${n} バイト${how === 'trial' ? '（試行錯誤による一致）' : ''}`,
    skip: (h) => `  ✗ ${h}：UnityFS ヘッダになるパスワードが無い`,
    done: (ok, skip) => `\n[4/4] 復号 ${ok} 件、スキップ ${skip} 件。`,
    arekOut: (f, n) => `  AREK.txt を ${f} に書き出しました（${n} 件、平文パスワード）`,
    skipNote: '\n注：判定は復号後の先頭が `UnityFS` であること。誤ったパスワードは捨てるだけで、壊れたデータは書き出さない。',
    noneOk: '一つも復号できませんでした。暗号化ツールのバージョンが変わった可能性があります（例：salt がファイル名でなくなった）。',
    noneOk2: 'README の「新旧パッケージの対照」と突き合わせるか、ゲーム名とバージョンを添えて issue を立ててください。',
    arekStale: '  注意：AREK.txt のパスワードはバージョン依存です。別ビルドのものなら、ここでは全て失敗します。',
    noSA: 'StreamingAssets/StandaloneWindows64 が見つかりません',
    noMD: 'global-metadata.dat が見つかりません',
    noAssets: 'resources.assets も data.unity3d も見つかりません',
    noGA: 'GameAssembly.dll が見つかりません',
    usage: '使い方：',
    usageScan: '  node ika9nt-unlock.mjs scan   --game <ゲームディレクトリ>',
    usageUnlock: '  node ika9nt-unlock.mjs unlock --game <ゲームディレクトリ> [--out <出力先>] [--sa <StreamingAssets>] [--arek-in <パス>] [--arek-out <パス>]',
    scanHead: (g) => `ゲームディレクトリ: ${g}`,
    scanFound: (md, ga, as) => `  metadata: ${md ? '✓' : '✗'}  GameAssembly: ${ga ? '✓' : '✗'}  resources.assets: ${as ? '✓' : '✗（先に unpack）'}`,
    scanPool: (c, n) => `  passCharacter: 候補 ${c} 件、選択 len=${n}`,
    scanGuid: (g) => `  GUID: ${g}`,
    apiHint: 'README の「仕組み」を参照',
  },
}

function detectLang(argv) {
  const fromArg = argv.find((a, i) => a === '--lang' && argv[i + 1])
  const explicit = fromArg ? argv[argv.indexOf(fromArg) + 1] : process.env.IKA9NT_LANG
  const want = (explicit || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '').toLowerCase()
  if (want.startsWith('ja')) return 'ja'
  if (want.startsWith('zh')) return 'zh'
  if (want.startsWith('en')) return 'en'
  return 'en'   // 没有明确语言时用英文，不猜
}

let LANG = 'en'
function t(key, ...args) {
  const v = MESSAGES[LANG]?.[key] ?? MESSAGES.en[key]
  return typeof v === 'function' ? v(...args) : (v ?? key)
}

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

/**
 * 从 resources.assets 里读出 `EncrypterKeyData` 的 label → hash 表。
 *
 * 布局（实测，Unity 序列化 + 无 TypeTree）：
 *
 *   "EncrypterKeyData"  (GUID 字符串)  labels[8]  (assetPath, int64 hash)[8]
 *
 * 每个元素都是普通 Unity 字符串：4 字节小端长度 + UTF-8 + 补齐到 4 字节边界。
 * assetPath 后面紧跟小端 int64 的 hash，两段按数组序号一一对应，
 * 所以第 i 个 label 就配第 i 个 hash —— **不用靠文件名去猜，也不需要穷举**。
 */
export function findLabels(assetsPath) {
  const b = fs.readFileSync(assetsPath)
  const guidAt = b.indexOf(Buffer.from('EncrypterKeyData', 'utf8'))
  if (guidAt < 0) throw new Error('resources.assets 里没有 EncrypterKeyData')

  const readString = (off) => {
    if (off + 4 > b.length) return null
    const len = b.readInt32LE(off)
    if (len <= 0 || len > 512 || off + 4 + len > b.length) return null
    const raw = b.subarray(off + 4, off + 4 + len)
    for (const c of raw) if (c < 0x20 || c > 0x7e) return null
    return { text: raw.toString('latin1'), next: (off + 4 + len + 3) & ~3 }
  }

  // 布局实测：
  //   "EncrypterKeyData" ... GUID(32) [4字节填充] [int32 数组长度] label×N
  //   ... [4字节填充] [int32 数组长度] (assetPath, int64 hash)×N
  // GUID 文本本身定位最稳——类名和它之间可能有对齐填充。
  let guid = null
  let cur = guidAt
  for (let i = 0; i < 8 && !guid; i++) {
    const r = readString((cur + 3) & ~3)
    if (r && /^[0-9a-f]{32}$/i.test(r.text)) { guid = r.text; cur = r.next; break }
    cur += 4
  }
  if (!guid) throw new Error('EncrypterKeyData 之后没找到 GUID 字符串')

  // GUID 之后固定 4 字节填充，再是数组长度
  cur = (cur + 3) & ~3
  cur += 4
  const count = b.readInt32LE(cur)
  cur += 4
  if (!(count > 0 && count <= 512)) throw new Error(`label 数组长度不合理：${count}`)

  const labels = []
  for (let i = 0; i < count; i++) {
    const r = readString(cur)
    if (!r) throw new Error(`第 ${i} 个 label 读不出`)
    labels.push(r.text)
    cur = r.next
  }

  // assetPath 数组前面还夹着别的字段，长度不可靠。
  // 改为扫描：从当前偏移向后找以 "Assets" 开头的 Unity 字符串，紧接其后的 int64 就是 hash。
  const pairs = []
  const limit = Math.min(b.length - 16, cur + 64 * 1024)
  while (pairs.length < count && cur < limit) {
    const r = readString(cur)
    if (r && r.text.startsWith('Assets')) {
      const hashAt = r.next
      if (hashAt + 8 <= b.length) {
        pairs.push({ assetPath: r.text, hash: b.readBigInt64LE(hashAt).toString() })
        cur = hashAt + 8
        continue
      }
    }
    cur += 4
  }
  if (pairs.length === 0) throw new Error('没找到任何 assetPath/hash 对')

  const table = {}
  const byHash = {}
  labels.forEach((label, i) => {
    table[label] = pairs[i].hash
    byHash[pairs[i].hash] = { label, assetPath: pairs[i].assetPath }
  })
  return { guid, labels, pairs, table, byHash }
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

// ── 五·五、AREK.txt ─────────────────────────────────────────────────────────

/**
 * 读 AREK.txt：每行 `label password hash`（旧 mod 与编辑器插件共用的格式）。
 * 只取 password 与 hash，label 忽略——本工具按密文文件名当 hash，不需要 label。
 */
export function readArek(file) {
  const text = fs.readFileSync(file, 'utf8')
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = t.split(/\s+/)
    if (parts.length < 3) continue
    rows.push({ label: parts[0], password: parts[1], hash: parts.slice(2).join(' ') })
  }
  if (rows.length === 0) throw new Error(`${file} 里没读到任何 label/password/hash 行`)
  return rows
}

/**
 * 写 AREK.txt。格式与旧 mod 一致，但 **label 位置填的是 hash**——label 表在
 * resources.assets 的 SerializedFile 里，本工具不解析它。写出来的文件本工具自己读得回来；
 * 旧 mod 若按 label 索引则对不上，这一点写在文件头里。
 * 文件含**明文密码**，这是这套工具的既有约定，权限设成 600。
 */
export function writeArek(file, rows) {
  const head = [
    '# ika9nt-unlock 生成',
    '# 格式：label password hash（与旧 IKA9nt.Decryptor 的 AREK.txt 相同）',
    '# 注意：label 位置填的是 hash —— label 表在本工具未解析的 SerializedFile 里。',
    '# 本文件含明文密码。',
  ].join('\n')
  const body = rows.map(r => `${r.label ?? r.hash} ${r.password} ${r.hash}`).join('\n')
  fs.writeFileSync(file, head + '\n' + body + '\n', { mode: 0o600 })
  return rows.length
}

// ── 六、命令 ────────────────────────────────────────────────────────────────

function cmdScan(args) {
  const game = args.game || '.'
  const files = walk(game)
  const md = files.find(f => f.endsWith('global-metadata.dat'))
  const ga = files.find(f => /GameAssembly\.dll$/i.test(f))
  const assets = files.find(f => /resources\.assets$/.test(f))
  console.log(t('scanHead', game))
  console.log(t('scanFound', md, ga, assets))
  if (md) {
    const r = findPassCharacter(md)
    console.log(t('scanPool', r.candidates.length, r.chosen.value.length))
  }
  if (assets) console.log(t('scanGuid', findGuid(assets).guid))
}

function cmdUnlock(args) {
  const game = args.game || '.'
  const out = args.out || path.join(game, 'decrypted')
  const saDir = args.sa || findStreamingAssets(game)
  if (!saDir) { console.error(t('noSA')); process.exit(2) }
  console.log(`${t('game')}: ${game}\n${t('sa')}: ${saDir}\n${t('out')}: ${out}`)

  // 1. metadata → passCharacter
  const md = walk(game).find(f => f.endsWith('global-metadata.dat'))
  if (!md) { console.error(t('noMD')); process.exit(2) }
  const pc = findPassCharacter(md)
  console.log(t('step1', pc.chosen.value.length))

  // 2. data.unity3d → resources.assets → GUID
  let assets = walk(game).find(f => /resources\.assets$/.test(f))
  if (!assets) {
    const du = walk(game).find(f => f.endsWith('data.unity3d'))
    if (!du) { console.error(t('noAssets')); process.exit(2) }
    const tmpAssets = path.join('/tmp', `ika9nt-assets-${process.pid}.bin`)
    const r = unpackFile(du, 'resources.assets', tmpAssets)
    console.log(t('step2', r.written.toLocaleString()))
    assets = tmpAssets
  }
  const g = findGuid(assets)
  const keyTable = findLabels(assets)
  console.log(t('step3', g.guid, keyTable.labels.length))

  // 3. 密码：优先读 AREK.txt（省掉 41 MB 反汇编），否则从 GameAssembly 推导
  let passwords
  if (args['arek-in']) {
    const rows = readArek(args['arek-in'])
    passwords = rows.map(r => r.password)
    console.log(t('step3arek', args['arek-in'], passwords.length))
    console.log(t('arekStale'))
  } else {
    const ga = walk(game).find(f => /GameAssembly\.dll$/i.test(f))
    if (!ga) { console.error(t('noGA')); process.exit(2) }
    const lines = disassemble(ga)
    const sub = detectSubstring(lines)
    const blocks = extractBlocks(lines, sub.target)
    console.log(t('step3b', sub.target, sub.count, sub.span.toString(16), blocks.length))
    passwords = blocks.map(b => passwordFromBlock(b, pc.chosen.value, g.guid))
  }

  // label 与密码的对应：KeyData 里 label 和 hash 同序，密码块按 map 写入序排列。
  // 两段都按「第 i 个配第 i 个」对齐——这是这次不再需要穷举的关键。
  const hashToPassword = new Map()
  if (passwords.length === keyTable.labels.length) {
    keyTable.labels.forEach((label, i) => {
      hashToPassword.set(keyTable.table[label], { label, password: passwords[i] })
    })
  }

  // 4. 解密并配对
  fs.mkdirSync(out, { recursive: true })
  let ok = 0, skipped = 0
  const matched = []   // { password, hash } —— 给 --arek-out 用
  for (const f of fs.readdirSync(saDir).filter(f => /^-?\d+$/.test(f))) {
    const src = path.join(saDir, f)
    const head = Buffer.alloc(16)
    const fd = fs.openSync(src, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd)
    const known = hashToPassword.get(f)
    let pw = null, label = null, how = ''

    if (known && makeCipher(known.password, f)(head, 0).toString('latin1', 0, 5) === 'Unity') {
      pw = known.password; label = known.label; how = '按表'
    } else {
      // 表对不上（顺序假设不成立 / label 数不一致）时才逐个试，并明确标注
      const alt = passwords.find(p => makeCipher(p, f)(head, 0).toString('latin1', 0, 5) === 'Unity')
      if (alt) { pw = alt; how = '试错' }
    }

    if (!pw) {
      console.log(t('skip', f))
      skipped++
      continue
    }
    const n = decryptFile(src, path.join(out, f), pw, f)
    console.log(t('ok', f, label, n.toLocaleString(), how === '试错' ? 'trial' : ''))
    matched.push({ label: label ?? f, password: pw, hash: f })
    ok++
  }
  console.log(t('done', ok, skipped))
  if (args['arek-out'] && matched.length) {
    const n = writeArek(args['arek-out'], matched)
    console.log(t('arekOut', args['arek-out'], n))
  }
  if (skipped) {
    console.log(t('skipNote'))
    if (ok === 0) {
      console.log(t('noneOk'))
      console.log(t('noneOk2'))
    }
    process.exitCode = 1
  }
}

function findStreamingAssets(game) {
  const hit = walk(game).filter(f => /StreamingAssets[\\/]StandaloneWindows64$/i.test(path.dirname(f)))
  return hit.length ? path.dirname(hit[0]) : null
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (!isMain) { /* 被 import 时只导出函数，不跑 CLI */ }
else {
const args = parseArgs(process.argv.slice(2))
LANG = detectLang(process.argv.slice(2))
const cmd = args._[0]
if (cmd === 'scan') cmdScan(args)
else if (cmd === 'unlock') cmdUnlock(args)
else {
  console.log(t('usage'))
  console.log(t('usageScan'))
  console.log(t('usageUnlock'))
  process.exit(2)
}
}
