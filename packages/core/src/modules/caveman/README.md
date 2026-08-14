# Caveman Module

Terse, filler-free prompt compression — "why use many token when few token do
trick". Strips polite filler, long-winded constructions and hedge words from a
prompt before it is sent to a model.

**Credits:** inspired by [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
(MIT skill) and the community "caveman prompt" experiments. See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).

```ts
import { cavemanStrategy } from '@mugil-ide/core';
cavemanStrategy('In order to fix the bug, please kindly review the code.');
// → 'to fix the bug, review the code.'
```
