# Function Calling + Simple Looping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Mugil IDE engine the ability to declare tools to a model, execute the tool calls the model requests, and loop the results back until the model produces a final answer — plus auto-detection of tool-calling capability in the model catalog.

**Architecture:** A provider-neutral `ToolDefinition`/`ToolCall`/`ChatMessage` shape is threaded through the existing handoff pipeline. Each provider client (OpenAI-family: `openAi.ts`/`openRouter.ts`; `anthropic.ts`) translates the neutral shape to its own wire format and parses tool calls back. A new `tool-loop` module owns the bounded agentic loop (max iterations, unknown-tool/exception capture, forced final answer). `Pipeline.ask` uses the loop only when the caller declares tools, and bypasses the smart cache for tool-bearing requests (a cache hit would skip tool execution). `ModelSpec` gains `supportsTools`, populated from OpenRouter's `supported_parameters` catalog field with a true-by-default heuristic elsewhere.

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), ts-jest, global `fetch`. No new dependencies. Node built-ins only.

## Global Constraints

- TypeScript strict mode; imports use `.js` suffixes (`import { x } from '../../types.js'`).
- **No new runtime dependencies** — use the global `fetch` already used by the provider clients; `zod` stays mcp-only.
- Every task ends with a green test run: `npm run test -w @mugil-ide/core`.
- `npm run typecheck` and `npm run lint` must stay clean at every commit.
- Backward compatibility: existing callers keep compiling. New fields on `ChatMessage`/`CompletionResult`/`AskResult` are additive.
- Provider-neutral internal format: `ToolCall.arguments` is always a **raw JSON string**; providers translate (OpenAI passes the string through, Anthropic JSON.stringifies its parsed `input`).
- Anthropic rule (enforced in `anthropic.ts`): each `tool`-role message becomes its **own** `user` message containing exactly one `tool_result` block (Anthropic forbids merging tool_results into one message).
- Cache is bypassed entirely (lookup AND store) when a request declares tools.

---

### Task 1: OpenAI-family tool calls (types, options, threading, openAi.ts, openRouter.ts)

**Files:**
- Modify: `packages/core/src/types.ts` (add `ToolDefinition`, `ToolCall`, widen `ChatMessage`, add `CompletionResult.toolCalls`)
- Modify: `packages/core/src/modules/handoff/provider.ts` (add `tools` to `ProviderCompleteOptions`; add shared `toOpenAiTools` helper)
- Modify: `packages/core/src/modules/handoff/openAi.ts` (send `tools`, parse `tool_calls`)
- Modify: `packages/core/src/modules/handoff/openRouter.ts` (send `tools`, parse `tool_calls`)
- Modify: `packages/core/src/modules/handoff/index.ts` (thread `tools` through `HandoffOptions` → `client.complete`)
- Test: `packages/core/tests/providerClients.test.ts`, `packages/core/tests/handoff.test.ts`

**Interfaces:**
- Consumes: existing `ChatMessage`, `CompletionResult`, `ProviderCompleteOptions`, `HandoffOptions`.
- Produces:
  ```ts
  export interface ToolDefinition {
    name: string;
    description: string;
    /** JSON Schema object for the tool's parameters (provider-agnostic). */
    parameters: Record<string, unknown>;
  }
  export interface ToolCall {
    id: string;
    name: string;
    /** Raw JSON string of the arguments, exactly as sent by the model. */
    arguments: string;
  }
  // ChatMessage gains:
  //   toolCalls?: ToolCall[]   // assistant messages that requested tools (content may be '')
  //   toolCallId?: string      // tool messages: id of the ToolCall this is the result of
  // CompletionResult gains: toolCalls?: ToolCall[]
  // ProviderCompleteOptions gains: tools?: ToolDefinition[]
  // HandoffOptions gains: tools?: ToolDefinition[]
  export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>>; // provider.ts
  ```

- [ ] **Step 1: Write the failing type + client tests**

Add to `packages/core/tests/providerClients.test.ts`:

```ts
describe('tool calling (OpenAI family)', () => {
  it('includes a tools array in the request body (OpenAI format)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const tool: ToolDefinition = {
      name: 'add',
      description: 'add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    };
    await client.complete([{ role: 'user', content: '2 + 3' }], { model: 'gpt-4o-mini', tools: [tool] });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>;
    };
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'add', description: 'add two numbers', parameters: tool.parameters } },
    ]);
  });

  it('parses tool_calls from the response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    const result = await client.complete([{ role: 'user', content: 'compute' }], {
      model: 'gpt-4o-mini',
      tools: [{ name: 'add', description: 'add two numbers', parameters: {} }],
    });
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('round-trips assistant toolCalls and tool results through the request body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'final', tool_calls: undefined }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new OpenAiClient({ apiKey: 'sk-test' });
    await client.complete(
      [
        { role: 'user', content: '2 + 3' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }] },
        { role: 'tool', toolCallId: 'call_1', content: '5' },
      ],
      { model: 'gpt-4o-mini', tools: [{ name: 'add', description: 'add', parameters: {} }] },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'user', content: '2 + 3' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add', arguments: '{"a":2,"b":3}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '5' },
    ]);
  });
});
```

Add to `packages/core/tests/handoff.test.ts` (mirror the existing stub-client harness in that file):

```ts
it('forwards tools to the provider client', async () => {
  const client = { mock: false, complete: jest.fn().mockResolvedValue(mockCompletion([], { model: 'm' }, 'X')) };
  const manager = new HandoffManager({ client: client as unknown as ProviderClient, models: [] });
  await manager.complete([{ role: 'user', content: 'hi' }], { tools: [{ name: 'add', description: 'add', parameters: {} }] });
  expect(client.complete).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ tools: [{ name: 'add', description: 'add', parameters: {} }] }),
  );
});
```

Update imports in both test files: `import type { ToolDefinition } from '../src/types.js';` and add `ProviderClient`, `mockCompletion`, `HandoffManager` imports where missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients|handoff"`
Expected: FAIL — `ToolDefinition`/`ToolCall` not exported (type errors), `tools` unknown on options, `toolCalls` missing on result.

- [ ] **Step 3: Add the types**

In `packages/core/src/types.ts`, before `ChatMessage`:

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object for the tool's parameters (provider-agnostic). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the arguments, exactly as sent by the model. */
  arguments: string;
}
```

Replace `ChatMessage` with:

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant messages that requested tools (content may be ''). */
  toolCalls?: ToolCall[];
  /** Tool messages: the id of the ToolCall this is the result of. */
  toolCallId?: string;
}
```

Add to `CompletionResult`: `toolCalls?: ToolCall[];` (after `finishReason`).

- [ ] **Step 4: Add options + shared helpers in provider.ts**

> **Ruling (Task 1):** the neutral `ChatMessage` format uses camelCase
> `toolCalls`/`toolCallId`, but OpenAI/OpenRouter's wire format requires
> snake_case `tool_calls`/`tool_call_id` and the clients pass `messages`
> through verbatim. The round-trip test below asserts the snake_case wire
> shape, so a shared `toOpenAiMessages(messages)` translator is required
> (mirroring the Anthropic translator in Task 2). It lives in provider.ts
> next to `toOpenAiTools` and is used by both openAi.ts and openRouter.ts.

In `packages/core/src/modules/handoff/provider.ts`:

```ts
import type { ChatMessage, CompletionResult, ThinkingLevel, ToolDefinition } from '../../types.js';

export interface ProviderCompleteOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgetTokens?: number;
  /** Tools the model may call. Omit for plain completions. */
  tools?: ToolDefinition[];
}

/** OpenAI-compatible `tools` wire format (used by openAi.ts and openRouter.ts). */
export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Neutral ChatMessage[] -> OpenAI-compatible wire messages. */
export function toOpenAiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m): Record<string, unknown> => {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}
```

- [ ] **Step 5: Thread tools through HandoffManager**

In `packages/core/src/modules/handoff/index.ts`, add `tools?: ToolDefinition[]` to `HandoffOptions` (in `types.ts`) and forward it in `complete`:

```ts
const result = await this.client.complete(messages, {
  model: modelId,
  maxTokens: options.maxTokens,
  temperature: options.temperature,
  thinkingLevel: options.thinkingLevel,
  thinkingBudgetTokens: options.thinkingBudgetTokens,
  tools: options.tools,
});
```

- [ ] **Step 6: Implement openAi.ts tool support**

In `packages/core/src/modules/handoff/openAi.ts`:

```ts
import { mockCompletion, ProviderError, toOpenAiTools, type ProviderClient, type ProviderCompleteOptions } from './provider.js';
import type { ChatMessage, CompletionResult, ToolCall, ToolDefinition } from '../../types.js';
```

In `complete`, build the body with translated messages and tools:

```ts
// body: { model: options.model, messages: toOpenAiMessages(messages) }
if (options.tools && options.tools.length > 0) {
  body.tools = toOpenAiTools(options.tools);
}
```

Widen the response type:

```ts
const data = (await res.json()) as {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};
```

After `let thinking = ...` and the `<think>` extraction, parse tool calls:

```ts
const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
  .filter((tc) => tc?.type === 'function' && Boolean(tc.function?.name))
  .map((tc) => ({
    id: tc.id ?? '',
    name: tc.function!.name!,
    arguments: tc.function!.arguments ?? '{}',
  }));
```

Note `content` may now be `null` — change `let content = message?.content ?? '';` stays valid. Add `toolCalls: toolCalls.length > 0 ? toolCalls : undefined` to the returned object.

- [ ] **Step 7: Implement openRouter.ts tool support (same wire format)**

In `packages/core/src/modules/handoff/openRouter.ts`:

```ts
import type { ChatMessage, CompletionResult, ToolCall } from '../../types.js';
import { mockCompletion, toOpenAiTools, type ProviderClient, type ProviderCompleteOptions } from './provider.js';
```

In `remoteComplete`, build the body with translated messages (`messages: toOpenAiMessages(messages)`) and add tools after the `body` literal:

```ts
if (options.tools && options.tools.length > 0) {
  body.tools = toOpenAiTools(options.tools);
}
```

Same response-widening and `tool_calls` parsing as Step 6, returning `toolCalls` when non-empty.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients|handoff"`
Expected: PASS.

- [ ] **Step 9: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/modules/handoff/provider.ts packages/core/src/modules/handoff/openAi.ts packages/core/src/modules/handoff/openRouter.ts packages/core/src/modules/handoff/index.ts packages/core/tests/providerClients.test.ts packages/core/tests/handoff.test.ts
git commit -m "feat(core): OpenAI-family tool calls in provider clients"
```

---

### Task 2: Anthropic tool calls (tool_use blocks + message translation)

**Files:**
- Modify: `packages/core/src/modules/handoff/anthropic.ts`
- Test: `packages/core/tests/providerClients.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `ToolCall`, `ChatMessage.toolCalls`/`toolCallId` from Task 1.
- Produces: nothing new externally — `AnthropicClient.complete` returns `CompletionResult` with `toolCalls` populated.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/providerClients.test.ts`:

```ts
describe('tool calling (Anthropic)', () => {
  it('includes tools in the Anthropic wire format', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete([{ role: 'user', content: 'hi' }], {
      model: 'claude-3-5-sonnet',
      tools: [{ name: 'add', description: 'add two numbers', parameters: { type: 'object' } }],
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      tools?: Array<{ name: string; description: string; input_schema: unknown }>;
    };
    expect(body.tools).toEqual([
      { name: 'add', description: 'add two numbers', input_schema: { type: 'object' } },
    ]);
  });

  it('parses tool_use blocks into ToolCalls', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [
          { type: 'text', text: 'let me compute' },
          { type: 'tool_use', id: 'toolu_1', name: 'add', input: { a: 2, b: 3 } },
        ],
        usage: { input_tokens: 5, output_tokens: 8 },
        stop_reason: 'tool_use',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    const result = await client.complete([{ role: 'user', content: 'compute' }], {
      model: 'claude-3-5-sonnet',
      tools: [{ name: 'add', description: 'add', parameters: {} }],
    });
    expect(result.content).toBe('let me compute');
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'add', arguments: '{"a":2,"b":3}' }]);
    expect(result.finishReason).toBe('tool_use');
  });

  it('translates assistant toolCalls and tool results into Anthropic messages', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: '5' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AnthropicClient({ apiKey: 'sk-ant-test' });
    await client.complete(
      [
        { role: 'user', content: '2 + 3' },
        {
          role: 'assistant',
          content: 'computing',
          toolCalls: [{ id: 'toolu_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        },
        { role: 'tool', toolCallId: 'toolu_1', content: '5' },
      ],
      { model: 'claude-3-5-sonnet', tools: [{ name: 'add', description: 'add', parameters: {} }] },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'user', content: '2 + 3' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'computing' },
          { type: 'tool_use', id: 'toolu_1', name: 'add', input: { a: 2, b: 3 } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '5' }] },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients"`
Expected: FAIL — `tools` not sent, `tool_use` blocks not parsed, no translation.

- [ ] **Step 3: Implement Anthropic tool support**

In `packages/core/src/modules/handoff/anthropic.ts`:

```ts
import type { ChatMessage, CompletionResult, ToolCall, ToolDefinition } from '../../types.js';
```

Replace the `AnthropicResponse` interface with:

```ts
interface AnthropicResponse {
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}
```

Add a module-level translator (before the class):

```ts
/** Neutral ChatMessage[] -> Anthropic wire messages. Each tool result becomes
 *  its own user message with a single tool_result block (Anthropic forbids
 *  merging tool_results). */
function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // handled via top-level `system` field
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId!, content: m.content }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments);
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}
```

In `complete`, replace `let chat = messages.filter((m) => m.role !== 'system');` with:

```ts
let chat = toAnthropicMessages(messages);
```

(Keep the existing empty-chat fallback after it.)

In the request body, add tools when present:

```ts
const body: Record<string, unknown> = {
  model: options.model,
  max_tokens: maxTokens,
  system: system.trim().length > 0 ? system : undefined,
  messages: chat,
  temperature,
  thinking: thinkingConfig,
};
if (options.tools && options.tools.length > 0) {
  body.tools = options.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
```

After the content/thinking extraction, parse tool_use blocks:

```ts
const toolCalls: ToolCall[] = blocks
  .filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
  .map((b) => ({ id: b.id!, name: b.name!, arguments: JSON.stringify(b.input ?? {}) }));
```

Add `toolCalls: toolCalls.length > 0 ? toolCalls : undefined` and `finishReason: data.stop_reason` (already present) to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients"`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/handoff/anthropic.ts packages/core/tests/providerClients.test.ts
git commit -m "feat(core): Anthropic tool calls with tool_use message translation"
```

---

### Task 3: The ToolLoop module (simple agentic looping)

**Files:**
- Create: `packages/core/src/modules/tool-loop/index.ts`
- Create: `packages/core/tests/toolLoop.test.ts`

**Interfaces:**
- Consumes: `HandoffManager` (Task 1), `ChatMessage`, `ToolCall`, `ToolDefinition`, `HandoffOptions`, `HandoffResult`.
- Produces:
  ```ts
  export type ToolExecutor = (call: ToolCall) => Promise<string>;
  export type ToolRegistry = Record<string, ToolExecutor>;

  export interface ToolLoopOptions {
    handoff: HandoffManager;
    /** Bounded iterations; a forced no-tools completion follows when exhausted. Default 6. */
    maxIterations?: number;
    /** Called with each executed tool call (for live progress events). */
    onTool?: (call: ToolCall, index: number) => void;
  }

  export interface ToolLoopRunOptions extends HandoffOptions {
    tools: ToolDefinition[];
    registry: ToolRegistry;
  }

  /** Mirrors HandoffResult with the number of executed tool calls. */
  export interface ToolLoopResult {
    provider: string;
    model: string;
    content: string;
    usage: Usage;
    finishReason?: string;
    mock?: boolean;
    thinking?: string;
    /** Models tried, in order, before success (from the final completion). */
    attempts: string[];
    /** Number of tool calls executed across the loop. */
    toolCalls: number;
  }

  > Ruling: `ToolLoopResult` does NOT extend `HandoffResult` —
  > `CompletionResult.toolCalls` is `ToolCall[] | undefined`, so a
  > `toolCalls: number` override in an extending interface is a TS2430
  > conflict. The standalone interface above mirrors the needed fields.

  export class ToolError extends Error {}

  export class ToolLoop {
    constructor(options: ToolLoopOptions);
    run(messages: ChatMessage[], options: ToolLoopRunOptions): Promise<ToolLoopResult>;
  }

  /** JSON.parse(call.arguments); throws ToolError on invalid JSON. */
  export function parseToolArguments(call: ToolCall): unknown;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/toolLoop.test.ts`:

```ts
import { HandoffManager } from '../src/modules/handoff/index.js';
import type { ProviderClient } from '../src/modules/handoff/provider.js';
import { ToolError, ToolLoop, parseToolArguments } from '../src/modules/tool-loop/index.js';
import type { ChatMessage, CompletionResult, ToolCall } from '../src/types.js';

/** Scripted client: each complete() call returns the next scripted result. */
function scriptedClient(script: CompletionResult[]): ProviderClient {
  let i = 0;
  return {
    mock: false,
    complete: jest.fn(async () => {
      const r = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return r;
    }) as unknown as ProviderClient['complete'],
  } as ProviderClient;
}

function result(over: Partial<CompletionResult>): CompletionResult {
  return {
    provider: 'openai',
    model: 'test-model',
    content: '',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    ...over,
  };
}

const ADD: import('../src/types.js').ToolDefinition = {
  name: 'add',
  description: 'add two numbers',
  parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
};

const registry = {
  add: async (call: ToolCall): Promise<string> => {
    const args = parseToolArguments(call) as { a: number; b: number };
    return String(args.a + args.b);
  },
};

const system = [{ role: 'system' as const, content: 'you are terse' }];

describe('ToolLoop', () => {
  it('returns immediately when the model makes no tool calls', async () => {
    const client = scriptedClient([result({ content: '5', finishReason: 'stop' })]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run(
      [...system, { role: 'user', content: '2 + 3' }],
      { tools: [ADD], registry },
    );
    expect(out.content).toBe('5');
    expect(out.toolCalls).toBe(0);
    expect(out.usage.totalTokens).toBe(15);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, feeds the result back, and returns the final answer', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
      }),
      result({ content: 'The answer is 5.', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run(
      [...system, { role: 'user', content: '2 + 3' }],
      { tools: [ADD], registry },
    );

    expect(out.content).toBe('The answer is 5.');
    expect(out.toolCalls).toBe(1);
    expect(client.complete).toHaveBeenCalledTimes(2);

    const secondCallMessages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(secondCallMessages[secondCallMessages.length - 1]).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      content: '5',
    });
  });

  it('feeds back an error string for an unknown tool so the model can recover', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'nope', arguments: '{}' }],
      }),
      result({ content: 'I cannot do that.', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run(
      [...system, { role: 'user', content: 'do it' }],
      { tools: [ADD], registry },
    );
    const messages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'Error: unknown tool "nope"',
    });
    expect(out.toolCalls).toBe(1);
  });

  it('captures executor exceptions as tool results', async () => {
    const boom = {
      add: async (): Promise<string> => {
        throw new Error('division by zero');
      },
    };
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":1,"b":0}' }],
      }),
      result({ content: 'failed', finishReason: 'stop' }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    await loop.run([...system, { role: 'user', content: 'divide' }], { tools: [ADD], registry: boom });
    const messages = (client.complete as jest.Mock).mock.calls[1]![0] as ChatMessage[];
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'tool',
      content: 'Error: division by zero',
    });
  });

  it('throws ToolError when a declared tool has no registry entry', async () => {
    const loop = new ToolLoop({ handoff: new HandoffManager({ client: scriptedClient([]), models: [] }) });
    await expect(
      loop.run([{ role: 'user', content: 'x' }], { tools: [ADD], registry: {} }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('forces a final answer without tools when iterations are exhausted', async () => {
    const alwaysCall = result({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":1,"b":2}' }],
    });
    const client = scriptedClient([alwaysCall, alwaysCall, alwaysCall, result({ content: 'forced', finishReason: 'stop' })]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }), maxIterations: 3 });
    const out = await loop.run(
      [...system, { role: 'user', content: 'loop forever' }],
      { tools: [ADD], registry },
    );
    expect(out.content).toBe('forced');
    expect(out.toolCalls).toBe(3);
    // The final (forced) completion must NOT send tools.
    const lastCall = (client.complete as jest.Mock).mock.calls.at(-1)![1] as { tools?: unknown };
    expect(lastCall.tools).toBeUndefined();
  });

  it('sums usage across iterations', async () => {
    const client = scriptedClient([
      result({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' }],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      }),
      result({ content: '5', finishReason: 'stop', usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 } }),
    ]);
    const loop = new ToolLoop({ handoff: new HandoffManager({ client, models: [] }) });
    const out = await loop.run(
      [...system, { role: 'user', content: '2 + 3' }],
      { tools: [ADD], registry },
    );
    expect(out.usage).toEqual({ promptTokens: 50, completionTokens: 15, totalTokens: 65 });
  });

  it('parseToolArguments throws ToolError on invalid JSON', () => {
    expect(() => parseToolArguments({ id: 'c', name: 'add', arguments: 'not json' })).toThrow(ToolError);
    expect(parseToolArguments({ id: 'c', name: 'add', arguments: '{"a":1}' })).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="toolLoop"`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/modules/tool-loop/index.ts`:

```ts
/**
 * Tool Loop — the agentic "function calling" loop.
 *
 * Given a chat history, a set of tool declarations and a registry of tool
 * executors, it repeatedly asks the model, executes any requested tool calls
 * (feeding results back as `tool` messages), and stops when the model replies
 * without tool calls. The loop is bounded: after `maxIterations` the model is
 * forced to answer without tools so a final text is always produced.
 */
import type { ChatMessage, HandoffOptions, ToolCall, ToolDefinition } from '../../types.js';
import type { HandoffManager, HandoffResult } from '../handoff/index.js';

export type ToolExecutor = (call: ToolCall) => Promise<string>;
export type ToolRegistry = Record<string, ToolExecutor>;

export interface ToolLoopOptions {
  handoff: HandoffManager;
  /** Bounded iterations; a forced no-tools completion follows when exhausted. Default 6. */
  maxIterations?: number;
  /** Called with each executed tool call (for live progress events). */
  onTool?: (call: ToolCall, index: number) => void;
}

export interface ToolLoopRunOptions extends HandoffOptions {
  tools: ToolDefinition[];
  registry: ToolRegistry;
}

/** Mirrors HandoffResult with the number of executed tool calls. */
export interface ToolLoopResult extends HandoffResult {
  toolCalls: number;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const MAX_ITERATION_PROMPT =
  'You have reached the maximum number of tool calls. Provide your final answer now without calling any tools.';

/** JSON.parse(call.arguments); throws ToolError on invalid JSON. */
export function parseToolArguments(call: ToolCall): unknown {
  try {
    return JSON.parse(call.arguments);
  } catch {
    throw new ToolError(`tool "${call.name}" received invalid JSON arguments: ${call.arguments}`);
  }
}

export class ToolLoop {
  private readonly handoff: HandoffManager;
  private readonly maxIterations: number;
  private readonly onTool?: (call: ToolCall, index: number) => void;

  constructor(options: ToolLoopOptions) {
    this.handoff = options.handoff;
    this.maxIterations = options.maxIterations ?? 6;
    this.onTool = options.onTool;
  }

  async run(messages: ChatMessage[], options: ToolLoopRunOptions): Promise<ToolLoopResult> {
    const missing = options.tools.map((t) => t.name).filter((name) => !(name in options.registry));
    if (missing.length > 0) {
      throw new ToolError(`no executor registered for tool(s): ${missing.join(', ')}`);
    }

    let msgs = [...messages];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let toolCalls = 0;

    for (let i = 0; i < this.maxIterations; i += 1) {
      const completion = await this.handoff.complete(msgs, { ...options, tools: options.tools });
      usage = this.sum(usage, completion.usage);
      if (!completion.toolCalls || completion.toolCalls.length === 0) {
        return { ...completion, usage, toolCalls };
      }

      msgs.push({
        role: 'assistant',
        content: completion.content ?? '',
        toolCalls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        toolCalls += 1;
        this.onTool?.(call, toolCalls);
        msgs.push({ role: 'tool', toolCallId: call.id, content: await this.execute(call, options.registry) });
      }
    }

    // Bounded: force a final answer without tools so we never return empty.
    const final = await this.handoff.complete([...msgs, { role: 'user', content: MAX_ITERATION_PROMPT }], {
      ...options,
      tools: undefined,
    });
    usage = this.sum(usage, final.usage);
    return { ...final, usage, toolCalls };
  }

  private async execute(call: ToolCall, registry: ToolRegistry): Promise<string> {
    const executor = registry[call.name];
    if (!executor) {
      return `Error: unknown tool "${call.name}"`;
    }
    try {
      return await executor(call);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private sum(a: { promptTokens: number; completionTokens: number; totalTokens: number }, b: { promptTokens: number; completionTokens: number; totalTokens: number }) {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="toolLoop"`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/tool-loop/index.ts packages/core/tests/toolLoop.test.ts
git commit -m "feat(core): bounded tool loop with registry and forced final answer"
```

---

### Task 4: Pipeline integration (loop wiring + cache bypass + events)

**Files:**
- Modify: `packages/core/src/types.ts` (`AskResult.toolCalls`, `PipelineEvent` tool event)
- Modify: `packages/core/src/pipeline.ts` (`AskOptions.toolRegistry`/`maxToolIterations`; run loop when tools declared; bypass cache)
- Test: `packages/core/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `ToolLoop`, `ToolRegistry`, `ToolError` (Task 3); `ToolDefinition` (Task 1).
- Produces:
  ```ts
  // AskOptions gains:
  //   toolRegistry?: ToolRegistry
  //   maxToolIterations?: number
  // AskResult gains: toolCalls: number
  // PipelineEvent gains: { type: 'tool'; name: string }
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/pipeline.test.ts` (reuse the file's existing engine/pipeline harness — check how it builds a `Pipeline` with a stubbed client and follow it):

```ts
it('runs the tool loop when tools are declared and bypasses the cache', async () => {
  const toolCalls = [
    { id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' },
  ];
  const client = {
    mock: false,
    complete: jest
      .fn()
      .mockResolvedValueOnce({
        provider: 'openai',
        model: 'test-model',
        content: '',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'tool_calls',
        toolCalls,
      })
      .mockResolvedValueOnce({
        provider: 'openai',
        model: 'test-model',
        content: '5',
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        finishReason: 'stop',
      }),
  };
  const engine = createEngineForTest(client); // the harness used by this test file
  const events: string[] = [];
  const result = await engine.pipeline.ask('2 + 3', {
    tools: [{ name: 'add', description: 'add two numbers', parameters: {} }],
    toolRegistry: {
      add: async (call: import('../src/types.js').ToolCall): Promise<string> =>
        String((JSON.parse(call.arguments) as { a: number; b: number }).a + (JSON.parse(call.arguments) as { a: number; b: number }).b),
    },
    onEvent: (ev) => {
      if (ev.type === 'tool') events.push(ev.name);
    },
  });

  expect(result.response).toBe('5');
  expect(result.toolCalls).toBe(1);
  expect(events).toEqual(['add']);
  // Cache must be bypassed: a fresh store would have captured the response.
  expect(result.cache.hit).toBe(false);
});
```

If the file's harness is `createEngine`, use it directly (it is exported from `../src/index.js`); otherwise follow whatever helper the file already defines. **Read `packages/core/tests/pipeline.test.ts` first and mirror its exact construction** — do not guess.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="pipeline"`
Expected: FAIL — `toolRegistry`/`toolCalls` unknown, no `tool` event.

- [ ] **Step 3: Add types**

In `packages/core/src/types.ts`:
- Add `toolCalls: number;` to `AskResult` (after `thinking`).
- Add `| { type: 'tool'; name: string }` to the `PipelineEvent` union.

- [ ] **Step 4: Implement pipeline wiring**

In `packages/core/src/pipeline.ts`:

```ts
import { ToolError, ToolLoop, type ToolRegistry } from './modules/tool-loop/index.js';
```

Add to `AskOptions`:

```ts
/** Executors for the declared tools. Required when `tools` is set. */
toolRegistry?: ToolRegistry;
/** Max tool-loop iterations before a forced final answer. Default 6. */
maxToolIterations?: number;
```

In `ask`, after `const effectiveBudget = ...`, add:

```ts
const hasTools = Boolean(options.tools && options.tools.length > 0);
```

Change the cache lookup guard from `if (!options.noCache)` to `if (!options.noCache && !hasTools)`.

Change the store guard at the bottom from `if (!options.noCache)` to `if (!options.noCache && !hasTools)`.

Replace the handoff call block:

```ts
emit({ type: 'stage', stage: 'handoff' });
const completion = hasTools
  ? await new ToolLoop({
      handoff: this.handoff,
      maxIterations: options.maxToolIterations,
      onTool: (call) => emit({ type: 'tool', name: call.name }),
    }).run(messages, {
      ...options,
      tools: options.tools!,
      registry: options.toolRegistry ?? {},
      maxTokens,
    })
  : await this.handoff.complete(messages, { ...options, maxTokens });
emit({
  type: 'handoff',
  attempts: completion.attempts,
  model: completion.model,
  mock: completion.mock,
});
```

In the return object, add `toolCalls: hasTools ? (completion as ToolLoopResult).toolCalls : 0` — import `ToolLoopResult` type for the cast. Also `thinking: completion.thinking` (already there) — `ToolLoopResult` extends `HandoffResult` which is a `CompletionResult`, so `completion.thinking` typechecks for both branches if you type `completion` as `HandoffResult | ToolLoopResult`.

The early cache-hit return must also include `toolCalls: 0`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w @mugil-ide/core`
Expected: PASS (pipeline test added; existing pipeline/cache tests unaffected — cache is only bypassed when tools are present).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/pipeline.ts packages/core/tests/pipeline.test.ts
git commit -m "feat(core): wire tool loop into pipeline with cache bypass and tool events"
```

---

### Task 5: Tool-calling capability detection in the model catalog

**Files:**
- Modify: `packages/core/src/config.ts` (`modelSupportsTools` heuristic)
- Modify: `packages/core/src/modules/handoff/models.ts` (populate `supportsTools` from OpenRouter `supported_parameters`)
- Modify: `packages/core/src/types.ts` (`ModelSpec.supportsTools`)
- Test: `packages/core/tests/providerClients.test.ts`

**Interfaces:**
- Consumes: `ModelSpec` (all catalog producers).
- Produces:
  ```ts
  // ModelSpec gains: supportsTools?: boolean
  export function modelSupportsTools(id: string): boolean; // config.ts
  ```

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/providerClients.test.ts`:

```ts
describe('tool-calling capability detection', () => {
  it('marks OpenRouter models that advertise tools support', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({
        data: [
          { id: 'a/model-with-tools', supported_parameters: ['temperature', 'tools'] },
          { id: 'b/model-without-tools', supported_parameters: ['temperature'] },
          { id: 'c/no-parameter-info' },
        ],
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const models = await fetchProviderModels({ provider: 'openrouter', apiKey: 'test-key' });
    expect(models.find((m) => m.id === 'a/model-with-tools')!.supportsTools).toBe(true);
    expect(models.find((m) => m.id === 'b/model-without-tools')!.supportsTools).toBe(false);
    expect(models.find((m) => m.id === 'c/no-parameter-info')!.supportsTools).toBe(true); // default true
  });

  it('defaults Ollama models to tool support', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      okResponse({ data: [{ id: 'llama3.2:latest' }] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const models = await fetchProviderModels({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    expect(models[0]!.supportsTools).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients"`
Expected: FAIL — `supportsTools` not on `ModelSpec`, not populated.

- [ ] **Step 3: Implement**

In `packages/core/src/types.ts`, add `supportsTools?: boolean;` to `ModelSpec` (after `supportsThinking`).

In `packages/core/src/config.ts`:

```ts
/** Whether a model can call tools. Conservative default true (all current
 *  providers' models support function calling); refined per-model by catalog
 *  data (e.g. OpenRouter `supported_parameters`). */
export function modelSupportsTools(id: string): boolean {
  return true;
}
```

In `packages/core/src/modules/handoff/models.ts`:
- Import `modelSupportsTools` from `../../config.js` (already imported there — add it to the existing import list).
- OpenRouter branch: widen the mapped type to include `supported_parameters?: string[]` and set:

```ts
supportsTools: Array.isArray(m.supported_parameters)
  ? m.supported_parameters.includes('tools')
  : modelSupportsTools(m.id),
```

- Ollama / LM Studio / local / OpenAI / Anthropic branches: add `supportsTools: modelSupportsTools(m.id)` to each mapped `ModelSpec` literal (they already set `supportsThinking`). For the Ollama fallback defaults and `DEFAULT_*` arrays in config.ts, add `supportsTools: modelSupportsTools(id)` where the entry sets `supportsThinking` — optional, since the field is optional; only the fetched catalogs strictly need it for the tests above. Keep the fallback default arrays unchanged to minimize churn (they default to `undefined`, which callers treat as "assume true").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @mugil-ide/core -- --testPathPattern="providerClients"`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/src/modules/handoff/models.ts packages/core/tests/providerClients.test.ts
git commit -m "feat(core): detect tool-calling capability in the model catalog"
```

---

### Task 6: Exports, module docs, and full verification

**Files:**
- Modify: `packages/core/src/index.ts` (export new module + types)
- Create: `packages/core/src/modules/tool-loop/README.md`
- Modify: `packages/core/src/modules/handoff/README.md`
- Modify: `project-context.md`, `README.md`

- [ ] **Step 1: Export from the barrel**

In `packages/core/src/index.ts`, after the handoff exports:

```ts
// Tool Loop (agentic function calling)
export { ToolLoop, ToolError, parseToolArguments } from './modules/tool-loop/index.js';
export type { ToolRegistry, ToolExecutor, ToolLoopOptions, ToolLoopRunOptions, ToolLoopResult } from './modules/tool-loop/index.js';
```

In the types export block add `ToolDefinition, ToolCall`. In the config export block add `modelSupportsTools`.

- [ ] **Step 2: Verify exports compile**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Write the module README**

Create `packages/core/src/modules/tool-loop/README.md` (mirror the tone of `handoff/README.md` — short, focused on behavior):

```markdown
# Tool Loop

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
```

- [ ] **Step 4: Update handoff README**

In `packages/core/src/modules/handoff/README.md`, add a short "Tools" subsection noting that `HandoffOptions.tools` is forwarded to the provider client and that tool round-trips are owned by the tool-loop module.

- [ ] **Step 5: Update project docs**

In `project-context.md`:
- Module tree / subsystems: add `modules/tool-loop/` (bounded agentic loop) and note `supportsTools` on `ModelSpec`.
- Gotchas: add "Tool-bearing requests bypass the cache" and "Tool loop is bounded; a forced no-tools completion guarantees a final answer".
- Status/test count: update the count after running the full suite (see Step 6).

In `README.md` (user-facing):
- Features table: add a row for function calling / tool loop.
- If the one-shot `--thinking` section is nearby, mention that tool use is engine-level and surfaced through `AskOptions.tools` (no CLI flag yet — CLI exposure is a follow-up).

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean; the new tests (providerClients, handoff, toolLoop, pipeline) pass alongside the existing 174. Update the test counts in `project-context.md` and `README.md` to the new total.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/modules/tool-loop/README.md packages/core/src/modules/handoff/README.md project-context.md README.md
git commit -m "docs(core): export tool loop and document function calling"
```

---

## Out of scope (documented follow-ups)

- **CLI/TUI surfacing** — no `/tools` command or `--tool` flag yet; callers use `AskOptions.tools`/`toolRegistry` programmatically. A TUI indicator for tool-capable models (like the 🧠 thinking hint) and a tool-call progress line are natural next steps now that `PipelineEvent` carries `{ type: 'tool' }`.
- **Built-in tool registry** — no default tools ship yet; the loop is tested with a sample `add` executor. Wiring `queryCodeGraph` (codegraph module) as a first real tool is a small follow-up.
- **MCP client consumption** — this plan makes the engine a tool *consumer*. The existing `@mugil-ide/mcp` server (tool *provider*) is untouched.
- **Mock-mode tool calls** — the offline mock still returns text only; tool loops are exercised via stub clients in tests.

## Self-Review

- **Spec coverage:** function calling (Tasks 1–2, per-provider wire formats) ✓; simple looping (Task 3, bounded loop with forced final answer) ✓; pipeline integration + cache bypass (Task 4) ✓; auto-detection of tool-calling models (Task 5, `supportsTools` + OpenRouter `supported_parameters`) ✓; exports/docs (Task 6) ✓. The "does it auto-detect tool calling models?" question from the originating discussion is answered by Task 5.
- **Placeholder scan:** no TBDs; every code step contains the full implementation or exact test.
- **Type consistency:** `ToolDefinition`/`ToolCall` defined in Task 1 and consumed unchanged in Tasks 2–4; `ToolLoopResult extends HandoffResult`; `AskResult.toolCalls` added in Task 4 and returned in both branches; `modelSupportsTools` defined in Task 5 and used in `models.ts` only. `ProviderCompleteOptions.tools` and `HandoffOptions.tools` both optional, so existing callers compile.
