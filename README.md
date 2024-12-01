# IKA9nt.Decryptor
Simple patch to inject a interctive console.
- Let the game decrypt bundles itself!
- Change screen resolution, refresh rate and V-Sync.

## Requirements
- [MelonLoader](https://github.com/LavaGang/MelonLoader) v0.6+(IL2CPP)
- MelonMod VSIX templates
- VisualStudio 2022
- [.NET 6.0 SDK](https://dotnet.microsoft.com/download/dotnet/6.0)

## Build
- Follow the instructions on [Melonloader Wiki](https://melonwiki.xyz/#/modders/quickstart?id=visual-studio-template) and setup your build environment.
- Add the source codes in [MelonMod](MelonMod) folder to your project.
- Build the solution and run the game, the console shold appear when mod initialized.
- run "help", and you know how it works.

## Editor Plugin(DEPRECATED)
Simple Unity editor script to decrypt IKA9nt (SeekableAesStream) bundles.
### Requirements
- Original IKA9nt.Encrypter from AssetStore. or SeekableAesStream class only.
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
└── Encrypter
    ├── 6241053  // Enccrypted bundle
    └── AREK.txt

AREK.txt Regex:
"(\S+) (\S+) (\S+)\n"
```
$1 bundleLabel
$2 bundlePassword
$3 bundleHash
