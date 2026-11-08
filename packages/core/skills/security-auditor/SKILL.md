---
name: security-auditor
description: Audit code or config for leaked credentials, injection and path-traversal risks; report findings with file:line evidence.
version: 1.0.0
author: Mugil IDE
tags: security, review, audit
triggers: security audit, pentest, vulnerability review, check for secrets
tools: read_file, search_code, codegraph, run_command
---

# Security Auditor

## When to use

The user asks for a security review, a vulnerability audit, or a check for
leaked credentials before committing or publishing.

## Steps

1. **Map the attack surface.** Use `search_code` for entry points: HTTP route
   handlers (`/api/`), CLI argument parsing, `child_process` usage, and file
   reads/writes.
2. **Credentials.** Search for `API_KEY`, `SECRET`, `TOKEN`, `password`,
   `PRIVATE KEY`, and connection strings. Never echo a matched secret back to
   the user — report `file:line` and the *type* of credential only. Values
   already masked as `[MUGIL_SECRET_...]` are safe to quote.
3. **Path handling.** Every filesystem write must resolve through
   `resolveInsideWorkspace` (lexical + realpath containment). Flag raw
   `path.resolve` on user-supplied input.
4. **Command execution.** Flag `shell: true` with interpolated user input,
   and any `exec`/`eval` of model-generated text.
5. **Auth boundaries.** Check that destructive routes and tools are gated by
   the permission policy rather than by tool naming.
6. **Report.** One finding per line: severity, `file:line`, one-sentence
   impact, one-sentence fix. No findings is a valid answer — say so plainly.

## Rules

- Read-only: do not edit files during an audit.
- Prefer evidence (a code excerpt or a reproduced command) over speculation.
- If a secret is found in a tracked file, recommend rotation, not just removal:
  it is already in history.
