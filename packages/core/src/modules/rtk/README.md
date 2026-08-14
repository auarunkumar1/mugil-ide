# RTK Module — Reduced Token Kernel

Removes redundant tokens from prompt context and tool output:
- `rtkStrategy` — strips intro/closing boilerplate and de-duplicates repeated
  sentences, keeping the imperative kernel.
- `compressCommandOutput` — RTK-style compression for shell output: collapses
  repeated lines, trims blank-line noise, truncates very long lines.

**Credits:** inspired by [rtk-ai/rtk](https://github.com/rtk-ai/rtk) ("Rust
Token Killer"), a CLI proxy compressing command output before it reaches the
LLM context window. See [ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).

```ts
import { rtkStrategy, compressCommandOutput } from '@mugil-ide/core';
```
