# ika9nt-unlock

[中文](README.md) ｜ **English** ｜ [日本語](README.ja.md)

Statically decrypt Unity AssetBundles encrypted by **IKA9nt.Encrypter** — without running the game, without injection, without touching the main executable.

The previous MelonLoader mod in this repository (see [`legacy/`](legacy/)) worked **at runtime**: inject into the game,
hook the decryption call, dump the password and an `AREK.txt` to disk. That approach is sensitive to the Unity version,
the IL2CPP backend, and the injector — it breaks as soon as the game updates.

This tool takes another route: **everything needed already lives in the shipped files.** Read them statically and compute.

```
$ node ika9nt-unlock.mjs unlock --game ./AldealRays_R18 --out ./decrypted
game: ./AldealRays_R18
StreamingAssets: ./AldealRays_R18/AldealRays_R18_Data/StreamingAssets/StandaloneWindows64
output: ./decrypted
  [1/4] passCharacter len=195
  [2/4] extracted resources.assets from data.unity3d (12,801,040)
  [3/4] GUID 050b90b4462e4391b531c9f6a36b8051
  [3/4] Substring=0x181178e90 (186 calls, span 0x2242), split into 8 groups
  ✓ -1441731759 → 596,520,900 bytes
  ✓ -1651898362 → 311,181,437 bytes
  ✓ -167652920 → 676,012,998 bytes
  ✓ -330351619 → 804,643,058 bytes
  ✓ 1208925433 → 515,373,584 bytes
  ✓ 1712697374 → 238,200,537 bytes
  ✓ 66086011 → 60,597,830 bytes

[4/4] decrypted 7, skipped 0.
```

---

## Requirements

| Item | Requirement | Notes |
|---|---|---|
| Node.js | **≥ 18** (`readBigInt64BE`, top-level `import`) | tested on 24.x |
| binutils | provides `objdump` | only needed by the disassembly step of `unlock`; `scan` does not need it |
| Disk | roughly "total ciphertext × 2" | input is not unpacked, output is written file by file, but both exist at once |
| Memory | no special requirement | streaming, ~1 MB resident buffer |

**Platform**: anything that runs Node (Linux / macOS / Windows). The tool calls no platform APIs except
`execFileSync('objdump', …)`.

On NixOS, borrow an `objdump` on the fly:

```bash
nix shell nixpkgs#binutils nixpkgs#nodejs --command node ika9nt-unlock.mjs unlock --game <dir>
```

**You do not need** Unity, .NET, Windows, or a runnable copy of the game.

---

## Usage

### One command

```bash
node ika9nt-unlock.mjs unlock --game <game root> [--out <output dir>] [--sa <StreamingAssets dir>]
```

| Flag | Required | Meaning |
|---|---|---|
| `--game` | yes | game root; the tool locates `global-metadata.dat`, `GameAssembly.dll`, `data.unity3d` itself |
| `--out` | no | plaintext output directory, defaults to `<game>/decrypted` |
| `--sa` | no | manually specify `StreamingAssets/StandaloneWindows64` when auto-discovery fails |

Every decrypted file is **verified**: the first four bytes must be `UnityFS`. Otherwise it is skipped and
counted, and the exit code is 1.

### Probe first

```bash
node ika9nt-unlock.mjs scan --game <game root>
```

Prints which files were found, the pool length, and the GUID. Changes nothing — good for confirming paths
before the real run.

### Verify separately

```bash
node ika9nt-unlock.mjs verify --dir <output dir>
```

Checks the `UnityFS` header of every plaintext file.

---

## How the inputs are found

This is what separates the tool from a script that makes you paste parameters: **all four inputs carry their
own criteria.**

| Input | Source | Criterion (a criterion, not a description — it can fail) |
|---|---|---|
| `passCharacter` | string literal table of `global-metadata.dat` (**UTF-8**, not UTF-16) | length 150–3000, all characters unique, only letters/digits/kana → exactly 1 hit in practice |
| `GUID` | within 512 bytes after `EncrypterKeyData` in `resources.assets` | exactly one 32-char lowercase hex string; more or fewer is an error, not a first-match |
| `Substring` address | disassembly of `GameAssembly.dll` | among targets called repeatedly via `mov $imm,%edx` + `call`, the one with **≥100 calls and a call-site span <64 KB** → unique in the whole binary |
| per-bundle password length | `call Array::new` between those call sites | the immediate is the length; yields `22,23,17,31,20,26,21,26` |
| salt | the ciphertext **filename** | entries matching `/^-?\d+$/` |

If `resources.assets` is absent, the tool streams it out of `data.unity3d` (UnityFS), **decompressing only the
blocks that cover the target** — a 5.19 GB archive costs one header read plus a few reads, about 1 second.

---

## Pairing: no brute force

Earlier versions tried every password on every ciphertext, using "the decrypted header must be `UnityFS`" as the criterion. That works, but it is the opposite of what this tool is for — it should know which password opens which bundle, the way the game itself does.

Now it can. `EncrypterKeyData` in `resources.assets` holds:

```
"EncrypterKeyData"  GUID(32)  [4-byte pad] [int32 N] label x N
                              [int32 N]    (assetPath, int64 hash) x N
```

The two arrays are in the **same order**, so label *i* pairs with hash *i*. `findLabels()` reads that table, `hash -> password` becomes a lookup, and every decryption is by table rather than by trial.

The label shows up in the output:

```
✓ -1441731759 [common]                    → 596,520,900 bytes
✓ -1651898362 [commonr18]                 → 311,181,437 bytes
✓ -167652920  [sceneresourcesextradefeat] → 676,012,998 bytes
```

Only when the table does not line up (label count ≠ password count, or the table-derived password fails the `UnityFS` check) does it fall back to trying each password — and that line is marked `试错匹配` (trial match). **The fallback exists, but it is never silent.**

## AREK.txt interop

```
--arek-out <path>   write `label password hash` after decrypting (same format as the old mod)
--arek-in  <path>   read passwords from it and skip the 41 MB disassembly step
```

The file contains **plaintext passwords** and is written with mode 600. Labels are now genuine, so the old mod and the editor plugin can consume it directly.

## How it works

Encryption lives in `SeekableAesStream` — a **random-access AES-CTR**:

```
key       = PBKDF2-SHA1(password.Trim(), salt = UTF8(hash), 1000 rounds, 32 bytes)
keystream = AES-256-ECB( LE64(blockNumber) ‖ 0^8 ), blockNumber starts at 1
plain[i]  = cipher[i] XOR keystream[i % 16]
```

The `salt` is the **filename** (that decimal integer), so the salt never needs to be searched for.

Passwords are generated by the asset's own editor at build time, and generation/runtime are inverse operations:

| Side | Code | Formula |
|---|---|---|
| build | `EncrypterEditor.cs` | `index = pool.IndexOf(pw[k]) + GUID[k]`, emitted as `Substring(index)` |
| runtime | `EncrypterCore.cs` | `pw[k] = pool[(pool.IndexOf(temp[k]) − GUID[k]) mod 195]` |

Because `Substring(i)` returns **exactly one** character, `pool.IndexOf(temp[k])` is precisely `i mod 195`.
So the immediates of the `Substring(i)` calls, the character pool, and the GUID are jointly sufficient —
**nothing has to be guessed, and the game never has to run.**

---

## Limits

Stated plainly:

- **Handles IKA9nt.Encrypter only.** A different encryption scheme invalidates all three criteria; the tool
  errors out rather than silently producing garbage.
- **Requires `objdump`.** `unlock` disassembles a 41 MB `GameAssembly.dll` (about 6 seconds). `scan` does not.
- **Assumes `EncrypterKeyData` exists.** If the game never shipped a key resource, `findGuid` fails loudly.
- **Does not parse UnityFS internals.** The output is standard `UnityFS`; use something else (AssetStudio,
  UABEA, …) to read the SerializedFile / Texture2D inside.
- **Does not handle the no-encrypt marker.** The asset supports tagging bundles with
  `@ThisAssetBundleisNoEncrypt`; those are unencrypted and simply won't match — they land in "skipped".
- **Not validated on a second game.** The criteria were derived from one sample (IL2CPP v31 / Unity
  2022.3.62f2). They should still hold for other games because they are structural rather than hard-coded
  addresses, but **I have no evidence for that.**

---

## Layout

```
ika9nt-unlock.mjs      the tool (no third-party dependencies)
legacy/                the previous version of this project, kept for reference only
  Editor/              Unity editor scripts used by the runtime decryptor
  MelonMod/            the MelonLoader injector-based decryptor
  README.previous.md   its README (documents the AREK.txt format)
  LICENSE.previous     its license
```

`legacy/` is **unmaintained**. It is kept because it is the original source for how `SeekableAesStream`
is implemented.

---

## License

See [`LICENSE`](LICENSE). The license for the previous project (inside `legacy/`) is at
[`legacy/LICENSE.previous`](legacy/LICENSE.previous).
