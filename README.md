# ika9nt-unlock

**中文** ｜ [English](README.en.md) ｜ [日本語](README.ja.md)


静态解密 **IKA9nt.Encrypter** 加密的 Unity AssetBundle，不运行游戏、不注入、不改主程序。

旧项目里那个 MelonLoader mod（见 [`legacy/`](legacy/)）的工作方式是**运行时**挂钩：注入游戏、拦下解密调用、把密码
连同 `AREK.txt` 一起写到磁盘。它对 Unity 版本、IL2CPP 后端、注入器都敏感——游戏一更新就容易失效。

这个工具走另一条路：**所有需要的东西都在产物里，静态读出来就能算**。

```
$ node ika9nt-unlock.mjs unlock --game ./AldealRays_R18 --out ./decrypted
游戏: ./AldealRays_R18
StreamingAssets: ./AldealRays_R18/AldealRays_R18_Data/StreamingAssets/StandaloneWindows64
输出: ./decrypted
  [1/4] passCharacter len=195
  [2/4] 从 data.unity3d 提出 resources.assets (12,801,040)
  [3/4] GUID 050b90b4462e4391b531c9f6a36b8051
  [3/4] Substring=0x181178e90（186 次，跨度 0x2242），切成 8 组
  ✓ -1441731759 → 596,520,900 字节
  ✓ -1651898362 → 311,181,437 字节
  ✓ -167652920 → 676,012,998 字节
  ✓ -330351619 → 804,643,058 字节
  ✓ 1208925433 → 515,373,584 字节
  ✓ 1712697374 → 238,200,537 字节
  ✓ 66086011 → 60,597,830 字节

[4/4] 解出 7，跳过 0。
```

---

## 所需环境

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 18**（用到 `readBigInt64BE`、顶层 `import`） | 实测 24.x |
| binutils | 提供 `objdump` | 只有 `unlock` 的反汇编那一步需要；`scan` 不需要 |
| 磁盘 | 约「密文总量 × 2」 | 输入不解包、输出逐个写，但两者同时存在 |
| 内存 | 无特殊要求 | 流式处理，常驻约 1 MB 缓冲 |

**平台**：任何能跑 Node 的地方（Linux / macOS / Windows）。工具本身不调用系统 API，只 `execFileSync('objdump', …)`。

NixOS 上临时取一个 `objdump`：

```bash
nix shell nixpkgs#binutils nixpkgs#nodejs --command node ika9nt-unlock.mjs unlock --game <目录>
```

**不需要** Unity、不需要 .NET、不需要 Windows、不需要游戏能跑起来。

---

## 使用方法

### 一条命令

```bash
node ika9nt-unlock.mjs unlock --game <游戏根目录> [--out <输出目录>] [--sa <StreamingAssets 目录>]
```

| 参数 | 必填 | 作用 |
|---|---|---|
| `--game` | 是 | 游戏根目录；工具会自己往下找 `global-metadata.dat`、`GameAssembly.dll`、`data.unity3d` |
| `--out` | 否 | 明文输出目录，默认 `<game>/decrypted` |
| `--sa` | 否 | 手动指定 `StreamingAssets/StandaloneWindows64`；自动找不到时用 |

解出来的每份明文都**验过头**：头 4 字节必须是 `UnityFS`。不是就跳过并计入「跳过」，退出码 1。

### 先探一下

```bash
node ika9nt-unlock.mjs scan --game <游戏根目录>
```

打印找到了哪些文件、字符池多长、GUID 是多少。不改任何东西，适合在真跑之前确认路径。

### 自己验一遍

```bash
node ika9nt-unlock.mjs verify --dir <输出目录>
```

对每份明文检查 `UnityFS` 头。

---

## 依赖是怎么被自动找到的

这是这个工具和「需要人喂参数的脚本」的区别：**四样输入全部自带判据**。

| 需要 | 来自 | 判据（判据本身会翻脸，不是描述） |
|---|---|---|
| `passCharacter` | `global-metadata.dat` 的 string literal 表（**UTF-8**，不是 UTF-16） | 长度 150–3000、字符全唯一、只由字母数字+假名组成 → 实测只命中 1 条 |
| `GUID` | `resources.assets` 里 `EncrypterKeyData` 之后 512 字节内 | 恰好 1 个 32 位小写十六进制串；多一个或少一个都报错而不是取第一个 |
| `Substring` 函数地址 | `GameAssembly.dll` 反汇编 | 被 `mov $imm,%edx` + `call` 反复调用的目标里，**次数 ≥100 且调用点跨度 <64 KB** 的那一个 → 全库唯一 |
| 每个 bundle 的密码长度 | 上述函数的调用点之间的 `call Array::new` | 立即数即长度；实测切成 `22,23,17,31,20,26,21,26` |
| **label → hash 对应** | `resources.assets` 里 `EncrypterKeyData` 的 `reference` 数组 | label 数组与 `(assetPath, int64 hash)` 数组**同序**，第 i 个配第 i 个 |
| 盐 | 密文的**文件名** | 目录里匹配 `/^-?\d+$/` 的条目 |

`resources.assets` 若不在磁盘上，工具会从 `data.unity3d`（UnityFS）里**流式只解开覆盖目标的那几个 block**——
5.19 GB 的包读一次头加几次 read 就够，约 1 秒。

---

## 配对：不靠试错

早期版本对每个密文**逐个试**每个密码，用「解出来的头必须是 `UnityFS`」当判据。这能用，但不符合这个工具的初衷——它应该像游戏自己那样，**知道哪个密码配哪个包**。

现在可以了。`EncrypterKeyData` 在 `resources.assets` 里的布局是：

```
"EncrypterKeyData"  GUID(32)  [4字节填充] [int32 N] label × N
                              ... [int32 N] (assetPath, int64 hash) × N
```

两段数组**同序**，所以第 i 个 label 就配第 i 个 hash，`findLabels()` 把这张表读出来之后，`hash → password` 就直接查得到，解密的每一步都用「按表」而不是「试错」。

实测输出会带上 label：

```
✓ -1441731759 [common]                    → 596,520,900 字节
✓ -1651898362 [commonr18]                 → 311,181,437 字节
✓ -167652920  [sceneresourcesextradefeat] → 676,012,998 字节
```

只有在表对不上时（label 数与密码数不等，或按表解不出 `UnityFS` 头）才退回逐个试，并且会在那一行明确标出「试错匹配」——**退路存在，但不静默**。

## AREK.txt 互操作

```
--arek-out <path>   解完后写出 `label password hash`（与旧 mod 的 AREK.txt 同格式）
--arek-in  <path>   直接读密码，跳过 41 MB 反汇编那一步
```

写出的文件**含明文密码**，权限设 600。因为 label 现在是真的，旧 mod 和编辑器插件都能直接用。


## 原理

加密在 `SeekableAesStream` 里，是一套**可随机访问的 AES-CTR**：

```
key       = PBKDF2-SHA1(password.Trim(), salt = UTF8(hash), 1000 轮, 32 字节)
keystream = AES-256-ECB( LE64(blockNumber) ‖ 0^8 )，blockNumber 从 1 起
plain[i]  = cipher[i] XOR keystream[i % 16]
```

其中 `salt` 就是**密文的文件名**（那个十进制整数），所以盐根本不用找。

密码由资产包自带的编辑器在构建时生成，生成侧和运行侧互为逆运算：

| 侧 | 代码 | 公式 |
|---|---|---|
| 生成 | `EncrypterEditor.cs` | `index = pool.IndexOf(pw[k]) + GUID[k]`，写出 `Substring(index)` |
| 运行 | `EncrypterCore.cs` | `pw[k] = pool[(pool.IndexOf(temp[k]) − GUID[k]) mod 195]` |

因为 `Substring(i)` 只取**一个字符**，`pool.IndexOf(temp[k])` 恰好就是 `i mod 195`。
于是「代码里那组 `Substring(i)` 的立即数 + 字符池 + GUID」三者就足以还原密码——
**没有一处需要猜，也没有一处需要运行游戏。**

---

## 边界

说清楚它做不到什么：

- **只处理 IKA9nt.Encrypter**。换一个加密方案，那三条判据全部不成立，工具会报错退出，不会静默解出错东西。
- **需要 `objdump`**。`unlock` 那一步要反汇编 41 MB 的 `GameAssembly.dll`（约 6 秒）。`scan` 不需要。
- **假设 `EncrypterKeyData` 存在**。如果游戏根本没生成密钥资源，`findGuid` 会明确报错。
- **不解 UnityFS 内部**。输出的 `UnityFS` 是标准格式，里面的 SerializedFile / Texture2D 要用别的东西读（AssetStudio、UABEA 等）。
- **不处理免加密标记**。资产包支持给某些 bundle 打 `@ThisAssetBundleisNoEncrypt`，那种包本来就没加密，不会被匹配到，会算进「跳过」。
- **没有在第二个游戏上验证过**。判据是从这一个样本（IL2CPP v31 / Unity 2022.3.62f2）推出来的；
  换游戏大概率仍然成立（因为判据是结构性的，不是硬编码地址），但**这一点我没有证据**。

---

## 旧项目的 MelonMod 也支持 v2.1+

`legacy/MelonMod/` 里那个注入式解密器，经过 [#3](https://github.com/Kihara777/IKA9nt.Decryptor/pull/3)（@OmaruKoma）的改动后，
在 v2.1+ 的游戏上也能用了。和静态工具的区别在于它仍然是运行时注入，需要游戏跑得起来。

v2.1 改了什么：

- `PasswordMap.map` 从 **static** 变成 `EncrypterCore.passwordMap` 后面的 **instance** 属性
- `map` 的值**不再是密码**，是原料；真密码要经 `EncrypterCore.GetPasswordFromMap(out password, label)` 推导，
  中间经过一个 195 字符的 alphabet（`0-9a-zA-Z` + 平假名 + 片假名 + 半角片假名）
- 盐来自 `EncrypterCore.GetSalt(label)`——实测就是 hash 的字符串形式，所以「密文文件名即盐」在 v2.1 仍然成立
- `SeekableAesStream` 本身没变

**这也是静态工具能工作的原因**：`ika9nt-unlock.mjs` 从一开始走的就是「从 `Substring` 立即数反推密码」这条路，
那正是 v2.1 的机制，只是当时不知道它叫 v2.1。

## 目录

```
ika9nt-unlock.mjs      工具本体（零第三方依赖）
legacy/                旧版本（运行时注入式）的原始内容，仅作参考
  Editor/              运行时解密用的 Unity 编辑器脚本
  MelonMod/            MelonLoader 注入式解密器
  README.previous.md   旧版 README（含 AREK.txt 格式说明）
  LICENSE.previous    旧版许可证
```

`legacy/` 里的东西**不再维护**，保留它是因为它是理解 `SeekableAesStream` 实现的原始出处。

---

## 许可证

见 [`LICENSE`](LICENSE)。旧项目部分（`legacy/`）的许可证见 [`legacy/LICENSE.previous`](legacy/LICENSE.previous)。
