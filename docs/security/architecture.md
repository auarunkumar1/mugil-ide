# Security Architecture: Secret Boundaries & Outbound Containment

## Overview

Mugil IDE operates as an autonomous agent runtime that reads files, executes shell commands, invokes local tools, and communicates with LLM inference providers. Because autonomous agents frequently interact with sensitive source code, configuration files (`.env`), and runtime logs, Mugil IDE implements a multi-tier security boundary to guarantee zero unintentional credential leaks.

---

## 1. Destination Classification (`classifyEndpoint`)

All HTTP, WebSocket, and model provider endpoints are classified into one of three network zones:

```
                  ┌──────────────────────┐
                  │ Destination Endpoint │
                  └──────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
       [loopback]      [private-lan]       [remote]
       127.0.0.1       10.0.0.0/8         api.openai.com
       localhost       172.16.0.0/12      openrouter.ai
       ::1             192.168.0.0/16     opencode.ai
```

- **Loopback**: Completely local to the host machine. Safe for raw token resolution when running local runtimes (`llama.cpp`, `ollama`, `lmstudio`).
- **Private LAN**: Internal subnet hosts. Classified as local only when explicitly enabled by policy (`MUGIL_IDE_LOCAL_ENDPOINTS=private-lan`).
- **Remote**: Any public or cloud internet destination. Subject to strict token vaulting, outbound sanitization, or fail-closed blocking.

---

## 2. Ephemeral In-Memory Secret Vault (`SecretVault`)

Credentials intercepted across any layer are tokenized:

```typescript
// Example replacement
"OPENAI_API_KEY=sk-proj-abc1234567890..."
  ▼
"OPENAI_API_KEY=[MUGIL_SECRET_OPENAI_API_KEY_1]"
```

### Exact Known Secret Pre-Registration
In addition to regex-based pattern matching, the engine automatically registers all configured provider keys into the vault during engine initialization (`createEngine`) and dynamic reload (`engine.reconfigure`).

Vault tokens are reversible only inside local process boundaries:
1. `run_command` resolves vault tokens back to real values prior to local shell execution.
2. Tool execution outputs are immediately re-tokenized before being appended to conversation history.
3. Vault clear operations (`vault.clear()`) re-seed registered known keys by default, ensuring continuous protection throughout the session lifecycle.

---

## 3. Policy Enforcement & Fail-Closed Routing (`HandoffManager`)

Mugil IDE supports environment-configurable security policies:

| Environment Variable | Allowed Values | Default | Purpose |
| -------------------- | -------------- | ------- | ------- |
| `MUGIL_IDE_SECRET_POLICY` | `local-only`, `redact` | `local-only` | `local-only` refuses remote clients for secret-bearing turns; `redact` permits cloud models with vault placeholders. |
| `MUGIL_IDE_SENSITIVE_POLICY` | `secrets`, `secrets+pii` | `secrets` | Policy for handling detected secrets in prompts and tool outputs. |
| `MUGIL_IDE_LOCAL_ENDPOINTS` | `loopback`, `private-lan` | `loopback` | Defines which network classifications are treated as trusted local runtimes. |

### Fail-Closed Boundary:
When `secretPolicy === 'local-only'`:
1. If an active turn contains vaulted tokens, the active provider client must be local (`llama.cpp`, Ollama, LM Studio, or a local endpoint).
2. If the active client is remote, `HandoffManager.buildChain()` throws a typed `SecretLeakError` before any network call. It never calls a remote client with a local model ID.
3. Select a local provider for the turn, or explicitly set `MUGIL_IDE_SECRET_POLICY=redact` to allow cloud models with placeholders.

---

## 4. Universal Egress Sanitization (`sanitizeOutbound`)

All outbound network requests pass through `sanitizeOutbound()` before reaching the wire:

- **Media & Image Prompts:** Image generation tools (`generate_image`) sanitize prompt arguments.
- **Web Fetch & Search:** URLs passed to `webfetch` and search queries passed to `websearch` have credentials and tokens stripped.
- **MCP Client:** Remote MCP server headers and tool arguments are scrubbed before RPC dispatch.
- **Provider Headers:** Downstream provider requests are filtered to prevent authorization header contamination across handoff hops.
- **Webhooks:** Webhook delivery payloads are checked and sanitized.

---

## 5. Non-Blocking Alerting UX

When a secret is first discovered and tokenized during an active agent turn:
- The vault fires an `onSecretDiscovered` event.
- The CLI REPL and Web xterm interface render a non-blocking informational banner:
  `[Secret Discovered & Vaulted: <TYPE>]`
- The turn proceeds seamlessly without interrupting execution, maintaining autonomous productivity while keeping developers informed.
