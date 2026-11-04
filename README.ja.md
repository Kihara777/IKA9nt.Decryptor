# ika9nt-unlock

[中文](README.md) ｜ [English](README.en.md) ｜ **日本語**

**IKA9nt.Encrypter** で暗号化された Unity AssetBundle を、ゲームを起動せず・インジェクションせず・本体を書き換えずに静的に復号します。

このリポジトリの旧プロジェクト（[`legacy/`](legacy/) を参照）の MelonLoader mod は**実行時**に動く方式でした。
ゲームに注入し、復号呼び出しをフックし、パスワードと `AREK.txt` をディスクに書き出します。
この方式は Unity のバージョン・IL2CPP バックエンド・インジェクタに敏感で、ゲームが更新されると壊れます。

本ツールは別の道を取ります。**必要なものはすべて生成物の中にあり、静的に読めば計算できる**のです。

```
$ node ika9nt-unlock.mjs unlock --game ./AldealRays_R18 --out ./decrypted
ゲーム: ./AldealRays_R18
StreamingAssets: ./AldealRays_R18/AldealRays_R18_Data/StreamingAssets/StandaloneWindows64
出力: ./decrypted
  [1/4] passCharacter len=195
  [2/4] data.unity3d から resources.assets を抽出 (12,801,040)
  [3/4] GUID 050b90b4462e4391b531c9f6a36b8051
  [3/4] Substring=0x181178e90（186 回、跨度 0x2242）、8 グループに分割
  ✓ -1441731759 → 596,520,900 バイト
  ✓ -1651898362 → 311,181,437 バイト
  ✓ -167652920 → 676,012,998 バイト
  ✓ -330351619 → 804,643,058 バイト
  ✓ 1208925433 → 515,373,584 バイト
  ✓ 1712697374 → 238,200,537 バイト
  ✓ 66086011 → 60,597,830 バイト

[4/4] 復号 7 件、スキップ 0 件。
```

---

## 必要な環境

| 項目 | 要件 | 備考 |
|---|---|---|
| Node.js | **≥ 18**（`readBigInt64BE`、トップレベル `import`） | 24.x で動作確認 |
| binutils | `objdump` を提供 | `unlock` の逆アセンブル段階のみ。`scan` は不要 |
| ディスク | おおよそ「暗号文の総量 × 2」 | 入力は展開せず、出力は 1 ファイルずつ書き出すが、両方が同時に存在する |
| メモリ | 特別な要件なし | ストリーミング処理、常駐バッファ約 1 MB |

**プラットフォーム**：Node が動く場所ならどこでも（Linux / macOS / Windows）。`execFileSync('objdump', …)`
以外にプラットフォーム API は呼びません。

NixOS では一時的に `objdump` を借ります：

```bash
nix shell nixpkgs#binutils nixpkgs#nodejs --command node ika9nt-unlock.mjs unlock --game <ディレクトリ>
```

**Unity・.NET・Windows・ゲームが起動できる環境は不要です。**

---

## 使い方

### コマンド 1 本

```bash
node ika9nt-unlock.mjs unlock --game <ゲームのルート> [--out <出力先>] [--sa <StreamingAssets>]
```

| 引数 | 必須 | 意味 |
|---|---|---|
| `--game` | はい | ゲームのルート。`global-metadata.dat` / `GameAssembly.dll` / `data.unity3d` は自動で探します |
| `--out` | いいえ | 平文の出力先。既定は `<game>/decrypted` |
| `--sa` | いいえ | 自動検出に失敗したとき `StreamingAssets/StandaloneWindows64` を明示 |

復号した各ファイルは**検証されます**。先頭 4 バイトが `UnityFS` でなければスキップして計上し、終了コードは 1 です。

### まず下調べ

```bash
node ika9nt-unlock.mjs scan --game <ゲームのルート>
```

どのファイルが見つかったか、文字プールの長さ、GUID を表示します。何も変更しないので、本番前に経路を確認するのに向いています。

### 別途検証

```bash
node ika9nt-unlock.mjs verify --dir <出力先>
```

平文すべての `UnityFS` ヘッダを確認します。

---

## 入力はどう自動で見つかるか

これが「引数を貼らせるスクリプト」との違いです。**4 つの入力すべてが自前の判定基準を持っています。**

| 入力 | 入手元 | 判定基準（説明ではなく基準。外れることがある） |
|---|---|---|
| `passCharacter` | `global-metadata.dat` の文字列リテラル表（**UTF-8**、UTF-16 ではない） | 長さ 150–3000、全文字が一意、英数字とかなのみ → 実測で 1 件だけ一致 |
| `GUID` | `resources.assets` の `EncrypterKeyData` から 512 バイト以内 | 32 桁小文字 16 進が**ちょうど 1 個**。多くても少なくてもエラー（先頭一致で済ませない） |
| `Substring` のアドレス | `GameAssembly.dll` の逆アセンブル | `mov $imm,%edx` + `call` で繰り返し呼ばれる対象のうち、**呼び出し ≥100 回かつ呼び出し地点の跨度 <64 KB** のもの → バイナリ全体で唯一 |
| 各バンドルのパスワード長 | その呼び出し地点の間にある `call Array::new` | 即値が長さ。実測で `22,23,17,31,20,26,21,26` |
| ソルト | 暗号文の**ファイル名** | `/^-?\d+$/` に一致する項目 |

`resources.assets` がディスク上に無い場合、`data.unity3d`（UnityFS）から**対象を覆うブロックだけを伸長して**
ストリーミング抽出します。5.19 GB のアーカイブでもヘッダ 1 回と数回の read で済み、約 1 秒です。

---

## 仕組み

暗号化は `SeekableAesStream` にあり、**ランダムアクセス可能な AES-CTR** です：

```
key       = PBKDF2-SHA1(password.Trim(), salt = UTF8(hash), 1000 回, 32 バイト)
keystream = AES-256-ECB( LE64(blockNumber) ‖ 0^8 )、blockNumber は 1 から
plain[i]  = cipher[i] XOR keystream[i % 16]
```

`salt` は**ファイル名**（の 10 進整数）なので、ソルトを探す必要はありません。

パスワードはアセット付属のエディタがビルド時に生成し、生成側と実行側は互いに逆演算です：

| 側 | コード | 式 |
|---|---|---|
| 生成 | `EncrypterEditor.cs` | `index = pool.IndexOf(pw[k]) + GUID[k]` を `Substring(index)` として出力 |
| 実行 | `EncrypterCore.cs` | `pw[k] = pool[(pool.IndexOf(temp[k]) − GUID[k]) mod 195]` |

`Substring(i)` は**1 文字だけ**返すので、`pool.IndexOf(temp[k])` はまさに `i mod 195` です。
したがって `Substring(i)` の即値・文字プール・GUID の 3 つで十分であり、
**どこにも推測は要らず、ゲームを動かす必要もありません。**

---

## 限界

はっきり書きます：

- **IKA9nt.Encrypter 専用**。別の暗号化方式では 3 つの基準がすべて成立せず、ツールは黙って壊れた物を出さずエラー終了します。
- **`objdump` が必要**。`unlock` は 41 MB の `GameAssembly.dll` を逆アセンブルします（約 6 秒）。`scan` は不要。
- **`EncrypterKeyData` の存在を仮定**。鍵リソースが無いゲームでは `findGuid` が明示的に失敗します。
- **UnityFS の内部は解析しません**。出力は標準 `UnityFS` です。中の SerializedFile / Texture2D は別のもの（AssetStudio、UABEA など）で読んでください。
- **無暗号マーカーは扱いません**。アセットは `@ThisAssetBundleisNoEncrypt` を付けられ、それらは元から平文なので一致せず「スキップ」に計上されます。
- **2 本目のゲームで検証していません**。基準は 1 サンプル（IL2CPP v31 / Unity 2022.3.62f2）から導きました。
  アドレスの決め打ちではなく構造的な基準なので他のゲームでも成立するはずですが、**その証拠はありません。**

---

## 構成

```
ika9nt-unlock.mjs      ツール本体（サードパーティ依存なし）
legacy/                旧プロジェクトの原本。参照用のみ
  Editor/              実行時復号に使われていた Unity エディタスクリプト
  MelonMod/            MelonLoader 注入方式の復号器
  README.previous.md   旧 README（AREK.txt の形式を記載）
  LICENSE.previous     旧ライセンス
```

`legacy/` は**メンテナンス対象外**です。`SeekableAesStream` の実装を知るための原典として残しています。

---

## ライセンス

[`LICENSE`](LICENSE) を参照。旧プロジェクト（`legacy/` 内）のライセンスは
[`legacy/LICENSE.previous`](legacy/LICENSE.previous) にあります。
