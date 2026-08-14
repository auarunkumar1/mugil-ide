# Codegraph Module

Builds a knowledge graph of a codebase — every symbol, import/dependency
edge and same-file call edge — so an agent gets **exactly the code it needs
for a task in one call**, instead of dumping the whole repo into context.

**Credits:** inspired by
[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) — "a
pre-built knowledge graph of every symbol, call edge, and dependency in your
codebase". This module reimplements the idea in TypeScript for this codebase
(regex-driven, no Tree-sitter). See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).

```ts
import { buildCodeGraph, queryCodeGraph } from '@mugil-ide/core';

const graph = buildCodeGraph(process.cwd());
const context = queryCodeGraph(graph, 'validate the token cache TTL');
for (const { symbol, score } of context) {
  console.log(`${symbol.file}:${symbol.line} [${score}] ${symbol.signature}`);
}
```

## What it extracts

| Piece | Description |
| --- | --- |
| **Symbols** | Exported functions, consts, classes, interfaces, types, enums (TS/JS); functions, classes (Python); funcs, structs/interfaces (Go); fns, structs, enums, traits (Rust) |
| **Snippets** | Each symbol carries the source block from its definition up to the next symbol (~60 lines max) — ready-made context |
| **Import edges** | File → imported module specifier (`from`/`require` in TS, `import`/`from` in Python, `import` in Go, `use` in Rust) |
| **Call edges** | Same-file references: symbol A's body mentions symbol B → edge A→B |

## Querying

`queryCodeGraph(graph, query)` ranks symbols by relevance to a task
description: name matches weigh most, then file path, then
signature/snippet matches. The result is the context-injection payload.

## Limitations

- Call edges are **same-file** name references (word-boundary matches inside
  a symbol's body). Cross-file call edges need import resolution, which is
  out of scope; the import edges give you the dependency map instead.
- Parsing is heuristic (regex), not a full compiler — false negatives are
  possible on unusual syntax.
- Rules live in `src/rules/codegraph.json` and are updatable at runtime via
  `mugil-ide update`.
