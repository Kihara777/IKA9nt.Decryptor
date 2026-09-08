# IKA9nt.Decryptor
Simple patch to inject a interctive console, mainly for AIdealRays, might support other ```IKA9nt.Encrypter``` games (theoretically, not tested however).
- Let the game decrypt bundles itself!
- Change screen resolution, refresh rate and V-Sync settings.

## Use the Mod
- Dodnload [MelonLoader](https://github.com/LavaGang/MelonLoader) v0.6+(IL2CPP) from releases and install it to your game directory by following its instructions.
- Copy ```IKA9ntDecryptor.dll``` to the MelonLoader's ```Mods``` folder.
- Run the game, the console shold appear.
- run "help", and you know how it works.
> [!NOTE]  
> Though we've decide to let it go, we still generate the AREK.txt during the decrypt process anyway.
> Check [AREK.txt Regex](###AREK.txt-Regex) for more info.

## Build
- Follow the instructions on [Melonloader Wiki](https://melonwiki.xyz/#/modders/quickstart?id=visual-studio-template) and setup your build environment.
- Add the source files in [MelonMod](MelonMod) folder to your project.
- Build the solution.

## AIdealRays v2.1+ support
`MelonMod` now works on both v1.9 and v2.1+ (`AIdealRays Ver_2.1` verified: 7/7 bundles decrypt to valid `UnityFS` files; the 8th label has no source file in `StreamingAssets`).
### What changed in v2.1
- `PasswordMap.map` went from **static** to an **instance** property behind `EncrypterCore.passwordMap`.
- `map` values are **no longer the passwords** - they are raw material. The true password must be derived per label via the (private static) `EncrypterCore.GetPasswordFromMap(out password, label)`, which maps characters through a 195-char alphabet (`PasswordMap.Substring(i)` / `PasswordCharacterSubstring(i)`: `0-9a-zA-Z` + hiragana + katakana + halfwidth katakana).
- The salt comes from the (private static) `EncrypterCore.GetSalt(label)` (in practice: UTF-8 bytes of the hash).
- The `SeekableAesStream` cipher itself is unchanged, so the game's own stream class is reused as-is.
### How the patch works (`MelonMod/Decrypt.cs`)
- Version-dependent members are resolved via reflection, so the file compiles against both v1.9 and v2.1 unhollowed assemblies: instance map first, static map as fallback; `GetPasswordFromMap` with raw-value fallback; `GetSalt` with `UTF8(hash)` fallback.
- All derivation runs up-front on the calling thread; worker tasks only touch the same stream surface v1.9 already used.
- `AREK.txt` now stores the **true** passwords, so the Editor flow keeps working unchanged.

## Editor Plugin(DEPRECATED)
Simple Unity editor script to decrypt ```IKA9nt.Encrypter (SeekableAesStream 256)``` bundles.
### Requirements
- ```SeekableAesStream``` class (included).
- Unity Editor
### Uue the Plugin
- Copy the [Editor](Editor) folder to you unity project.
- Click ```IKA9nt => EncrypterBundlePath``` button on the toolbar, it should open a folder.
- Copy the encrypted bundle and AREK.txt to this folder.
- Click ```IKA9nt => Decryptor``` to start the decrypt process.
### Work Folder Structure
```
[Applation.persistentDataPath]/
├── Decryptor
│   ├── decryptedBundle
│   └── ... 
└── Encrypter
    ├── 6241053  // Enccrypted bundles
    ├── ...
    └── AREK.txt
```
### AREK.txt Regex: ```"(\S+) (\S+) (\S+)\n"```
- $1 bundleLabel
- $2 bundlePassword
- $3 bundleHash
