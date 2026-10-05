# TODO

## Next Release

- [x] **Fix Thinking Block Placement & Stream Routing**: Streamed reasoning blocks and `<think>` tags now route live to `onThinking` before the answer delta stream, rendering the reasoning block above the model response and eliminating duplicate thinking printing below answers.
- [x] **Fix Streamed Output Formatting**: Streamed responses are formatted token-by-token using `StreamMarkdown` (headers, bullets, bold, inline code, fenced code blocks) with zero line-buffering delay, ensuring formatted stream output matches terminal presentation while preserving real-time token streaming.
- [x] **Lock User Query Input to UI Text Box**: Locked query input to the `#chat-input` field in the web UI. Disabled stdin on `agentTerm` (preserving Ctrl+C interrupt) and removed `inputBuffer` concatenation on `agent_input` to prevent merging previous terminal characters with current queries.
