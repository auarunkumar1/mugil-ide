# TODO

## Next Release (Shipped in 0.1.14)

- [x] **Fix Thinking Block Placement & Stream Routing**: Streamed reasoning blocks and `<think>` tags now route live to `onThinking` before the answer delta stream, rendering the reasoning block above the model response and eliminating duplicate thinking printing below answers.
- [x] **Fix Streamed Output Formatting**: Streamed responses are formatted token-by-token using `StreamMarkdown` (headers, bullets, bold, inline code, fenced code blocks) with zero line-buffering delay, ensuring formatted stream output matches terminal presentation while preserving real-time token streaming.
- [x] **Lock User Query Input to UI Text Box**: Locked query input to the `#chat-input` field in the web UI. Disabled stdin on `agentTerm` (preserving Ctrl+C interrupt) and removed `inputBuffer` concatenation on `agent_input` to prevent merging previous terminal characters with current queries.

## Next Release (Shipped in 0.1.15)

- [x] **Autonomous Context Compaction**: Proactive structured compaction digest generated when conversation history approaches budget thresholds (`MUGIL_IDE_HISTORY_BUDGET`), preserving critical project state, file changes, and architectural decisions without manual `/compact` or sudden turn eviction.
- [x] **Deterministic Tool Caching**: Cache idempotent read-only tool calls (`read_file`, `read_skeleton`, `search_code`, `codegraph`) across turns keyed on file mtime and workspace revision counter, invalidated on mutations (`write_file`, `edit_file`, `apply_patch`, `run_command`).
- [x] **Tool Call Resiliency & Error Recovery**: Fixed fatal `ToolError` terminations on malformed tool arguments and empty completions; extended default shell execution timeout to 60s with `MUGIL_IDE_COMMAND_TIMEOUT` support.

## Planned / Next Release

- [ ] **Cross-Provider Prompt Caching & Prefix Stability**: Strict byte-level prefix stability and prompt cache breakpoints extended across OpenAI, DeepSeek, and Gemini gateways (beyond existing Anthropic ephemeral cache control).
- [ ] **Unified Git Diff & Command Minimization**: Dedicated 1-line context git diff compression and test/build runner noise filter.

