# Contributing to Mugil IDE

Thank you for your interest in contributing to Mugil IDE! We welcome contributions to our autonomous browser-first AI IDE and runtime.

---

## Workspace Architecture

Mugil IDE is structured as an npm workspaces monorepo:

| Package | Directory | Description |
| ------- | --------- | ----------- |
| `@mugil-ide/core` | `packages/core` | Core agent loop, model handoff, tool execution, secret vault, and caching engine. |
| `mugil-ide` | `packages/cli` | Browser web IDE server, xterm.js terminal integration, REPL, and CLI commands. |
| `@mugil-ide/docs` | `packages/docs` | Embedded documentation and help guides. |
| `@mugil-ide/mcp` | `packages/mcp` | Standalone Model Context Protocol server exposing IDE capabilities. |

---

## Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or later (Node 20+ recommended).
- **npm**: v9.0.0 or later.
- **Git**

### Installation & Build
```bash
# Clone repository
git clone https://github.com/auarunkumar1/mugil-ide.git
cd mugil-ide

# Install workspace dependencies
npm install

# Build all packages
npm run build
```

---

## Running Verification & Tests

Before submitting changes, ensure the entire test suite, typecheck, linting, and secret checks pass cleanly:

### 1. Test Suite
```bash
# Run all tests across the monorepo
npm test

# Run tests for a specific workspace
npm test -w @mugil-ide/core
npm test -w packages/cli
```

### 2. Typechecking & Linting
```bash
# Run TypeScript compilation checks across all packages
npm run typecheck

# Run linter
npm run lint
```

### 3. Secret Scanner Guard
Ensure no API keys, credentials, or `.env` files are accidentally committed:
```bash
node scripts/guard-secrets.mjs
```

You can wire this check as a git pre-commit hook automatically:
```bash
git config core.hooksPath .githooks
```

---

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names like `feat/opencode-native-protocols` or `fix/stream-markdown-tables`.
2. **Hermetic Tests**: Ensure all new features or bug fixes include hermetic unit/integration tests that run without external network access.
3. **Opt-in Live Tests**: Network tests against external APIs belong in `scripts/provider-smoke.mjs` guarded by `MUGIL_IDE_LIVE_PROVIDER_TESTS=1`.
4. **Clean Commits**: Keep commit messages concise and descriptive according to Conventional Commits format (`feat: ...`, `fix: ...`, `chore: ...`).
