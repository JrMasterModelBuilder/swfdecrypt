# swfdecrypt

Decrypt/deobfuscate/unpack obfuscated SWF files.


# Overview

Currently unpacks (SWF Encrypt 4+?) packed AS1/AS2 code in unknown tag `253` before the following tags:

-   `DoAction` (`12`)
-   `PlaceObject2` (`26`)
-   `DefineButton2` (`34`)
-   `DoInitAction` (`59`)

Support for more tags is possible if such samples exist.

Only supports uncompressed SWF files, so decompress with `flasm -x file.swf` first as needed.

NOTE: The encrypt/decrypt terminology is a marketing misnomer, there is not real crypto involved, just obfuscation.


# Usage

```
node main.mjs in.swf out.swf
```


# How it Works

There was an old Flash AS1/AS2 obfuscation trick which involved jumping out of the defined actions block and into an unknown block where the real code was hidden. This worked because unknown tags were ignored by the player, and jumping out of the current actions block was also permitted in ASVM1.

So for example, one obfuscation software would turn the following frame action:

```
// TAG 43 HEADER
ConstantPool "Not so secret"
Push "Not so secret"
Trace
End
```

Into two tags like this:

```
// TAG 253 HEADER
// JUNK

loc1:
Push "Not so secret"
Trace
Jump loc3

loc2:
Jump loc1

loc3:
Jump loc4

// TAG 43 HEADER
DefineFunction "\x01\x02" 0 {
Push 1711 511
Modulo
Push 5
Multiply
Return
}
Push "\x01" -771 0.0 "\x01\x02"
CallFunction
Add2
DefineLocal

// JUNK (conditional jumps not matching "\x01")

ConstantPool "Not so secret"

// Conditional that matches value of "\x01" (taken)
Jump loc2
ConstantPool "garbage"

loc4:
Jump loc5

// JUNK

loc5:
End
```

Obviously this isn't very secure, and decompilers have added logic to compensate for this trickery, but there do not appear to be any existing automated unpackers that can restore the unobfuscated SWF file, until now.

This utility can trace over the obfuscated code, find the real `ConstantPool` if present, and reconstruct the original bytecode actions.

It also removes the extra unknown tag `255` (watermark?) from the header of the file.


# Bugs

If you find a bug or have compatibility issues, please open a ticket under issues section for this repository.


# License

Copyright (c) 2021-2022 JrMasterModelBuilder

Licensed under the Mozilla Public License, v. 2.0.

If this license does not work for you, feel free to contact me.
