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
> Check [Work Folder Structure](###Work-Folder-Structure) for more info.

## Build
- Follow the instructions on [Melonloader Wiki](https://melonwiki.xyz/#/modders/quickstart?id=visual-studio-template) and setup your build environment.
- Add the source files in [MelonMod](MelonMod) folder to your project.
- Build the solution.

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
```[Applation.persistentDataPath]/
├── Decryptor
│   ├── decryptedBundle
└── Encrypter
    ├── 6241053  // Enccrypted bundle
    └── AREK.txt

AREK.txt Regex:
"(\S+) (\S+) (\S+)\n"```
- $1 bundleLabel
- $2 bundlePassword
- $3 bundleHash
