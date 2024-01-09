# IKA9nt.Decryptor
Simple Unity editor script to decrypt IKA9nt (SeekableAesStream) bundles.

## Requirements
・　Original IKA9nt.Encrypter from AssetStore. or SeekableAesStream class only.
・　Unity Editor

## Instruction
```
[Applation.persistentDataPath]/
├── Decryptor
│   ├── decryptedBundle
└── Encrypter
    ├── 6241053
    └── AREK.txt

AREK.txt Regex: "(\S+) (\S+) (\S+)\n"
$1 bundleLabel
$2 bundlePassword
$3 bundleSalt
``
