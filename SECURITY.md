# Security Policy

Mugil IDE treats AI autonomy and developer privacy as first-class constraints. This document details our security boundaries, credential isolation models, and vulnerability disclosure process.

---

## Supported Versions

Security updates and patches are actively applied to the following release series:

| Version | Supported          |
| ------- | ------------------ |
| 0.6.x   | :white_check_mark: |
| 0.5.x   | :white_check_mark: |
| < 0.5.0 | :x:                |

---

## Security Model & Boundary Architecture

Mugil IDE enforces strict security boundaries designed to prevent accidental leakage of sensitive credentials and source code:

### 1. In-Memory Ephemeral Secret Vault
- **Ingestion Tokenization:** Pasted secrets, keys in `.env` files, or credentials discovered in tool outputs are intercepted before reaching conversation history or model context.
- **Vault Token Replacement:** Real credentials are substituted with deterministic local placeholders:
  `[MUGIL_SECRET_<TYPE>_<N>]`
- **In-Memory Storage:** Real secrets exist strictly in volatile process memory and are resolved only during local command execution (`run_command`).
- **Dynamic Re-Registration:** Configured provider credentials (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, etc.) are pre-registered on startup and re-seeded on dynamic configuration reloads.

### 2. Network Boundary Classification & Fail-Closed Guard
All outbound network destinations are classified into three strict operational tiers via `classifyEndpoint()`:
- `loopback` (`127.0.0.1`, `localhost`, `::1`)
- `private-lan` (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- `remote` (External cloud hosts and public APIs)

`MUGIL_IDE_SECRET_POLICY=local-only` is the default. When an agent turn contains vaulted or detected secrets:
- The handoff manager requires the active provider client to be local (`llama.cpp`, Ollama, LM Studio, or a local endpoint). It never silently calls a remote client with a local model ID.
- If the active client is remote, the turn **fails closed immediately** with `SecretLeakError`, preventing credentials or tokenized payloads from egressing to cloud providers.
- Set `MUGIL_IDE_SECRET_POLICY=redact` to explicitly allow cloud models with vault placeholders.

### 3. Comprehensive Outbound Egress Sanitization
All external egress channels pass through `sanitizeOutbound()`:
- **Media Tools:** Image generation prompts (`generate_image`) are sanitized.
- **Workspace Tools:** Remote URLs (`webfetch`) and search queries (`websearch`) are stripped of secrets and tokens.
- **Remote MCP Tools:** Remote MCP tool parameters and connection headers are scrubbed.
- **Provider HTTP Headers:** Downstream provider requests are filtered to prevent authorization header contamination across handoff hops.
- **Webhooks:** Webhook payloads (`fireWebhooks`) are cleansed of raw secrets before dispatch.

### 4. Non-Blocking Developer UX
- Secret discovery triggers a non-blocking `onSecretDiscovered` notification banner in CLI and Web xterm sessions, alerting developers without aborting execution mid-flight.

### 5. Pre-Commit Guard (`scripts/guard-secrets.mjs`)
- Pre-commit scanning inspects staged and untracked files for long-form provider keys, tokens, JWTs, and bare `.env` files to prevent accidental commits to git repositories.

---

## Reporting a Vulnerability

If you discover a security vulnerability or potential credential leak vector in Mugil IDE, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Send an email to **`auarunkumar1@gmail.com`** with:
   - Description of the vulnerability and attack vector.
   - Minimal proof-of-concept steps or reproduction script.
   - The affected version(s) of Mugil IDE.
3. We will acknowledge receipt within 48 hours and work with you on a coordinated fix and release timeline before public disclosure.
