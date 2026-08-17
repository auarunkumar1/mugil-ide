# Tool Loop Module

Bounded agentic "function calling" loop. Given a chat history, declared
`ToolDefinition`s and a `ToolRegistry` (name → async executor), it asks the
model, executes every requested tool call, feeds each result back as a `tool`
message, and repeats until the model answers without tool calls.

## Credits & Upstream Standards

- **Model Context Protocol (MCP)** (`@modelcontextprotocol/sdk`) — [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **OpenAI Function Calling** — [platform.openai.com/docs/guides/function-calling](https://platform.openai.com/docs/guides/function-calling)
- **Anthropic Tool Use** — [docs.anthropic.com](https://docs.anthropic.com)
- **Agent Skills Architecture** — Anthropic Tool Use & Claude Code skills standards (`anthropics/anthropic-tools`, `JuliusBrussee/caveman`, `DietrichGebert/ponytail`)
- **Coding-agent permissions + environment context** — OpenCode (`sst/opencode`) and Pi (`earendil-works/pi`): `allow`/`ask`/`deny` tool policies, per-command bash rules, `AGENTS.md`/`CLAUDE.md` injection, todo tools

## Behavior

- **Neutral format** — `ToolCall.arguments` is a raw JSON string; each provider
  client (OpenAI/OpenRouter/Anthropic) translates to its own wire format.
- **Bounded** — `maxIterations` (default 6). When exhausted, the model is
  asked to stop using tools and summarize the work completed plus the
  remaining steps, so a final text is always produced.
- **Permitted** — an optional `permission(call)` gate (see
  `modules/tools/permissions.ts`) can deny a call; the denial is fed back to
  the model as a `Permission denied: ...` tool result so it can recover.
  Denied calls never execute.
- **Resilient** — unknown tools and executor exceptions are returned to the
  model as `Error: ...` tool results so it can recover.
- **Validation** — a declared tool without a registry entry throws `ToolError`
  before any request is sent.
- **Usage** — token usage is summed across iterations.

## Wire-in

`Pipeline.ask` runs the loop when `AskOptions.tools` is set (with a matching
`toolRegistry`). Tool-bearing requests bypass the smart cache entirely: a
cache hit would skip tool execution. Progress is emitted as `{ type: 'tool' }`
pipeline events.
