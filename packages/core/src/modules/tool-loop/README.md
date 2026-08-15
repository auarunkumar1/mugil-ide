# Tool Loop Module

Bounded agentic "function calling" loop. Given a chat history, declared
`ToolDefinition`s and a `ToolRegistry` (name → async executor), it asks the
model, executes every requested tool call, feeds each result back as a `tool`
message, and repeats until the model answers without tool calls.

## Behavior

- **Neutral format** — `ToolCall.arguments` is a raw JSON string; each provider
  client (OpenAI/OpenRouter/Anthropic) translates to its own wire format.
- **Bounded** — `maxIterations` (default 6). When exhausted, the model is
  forced to answer *without* tools so a final text is always produced.
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
