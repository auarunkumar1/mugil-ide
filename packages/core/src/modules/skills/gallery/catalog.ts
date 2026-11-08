/**
 * Curated Open-Source Skills Catalog
 * ==================================
 * Curated, battle-tested skills derived from open-source agent tooling
 * (Anthropic Claude Code standard, Playwright, OWASP, Docker, etc.).
 * Bundled offline with full attribution, license specifications, and instructions.
 */

import type { GallerySkill } from './types.js';

export const CURATED_GALLERY_SKILLS: GallerySkill[] = [
  {
    id: 'system-architect',
    name: 'System Architect',
    description:
      'High-level distributed architecture design, RFC drafting, data flow diagrams, and trade-off analysis.',
    category: 'Architecture',
    author: 'Anthropic Claude Code Standards & Community',
    upstreamUrl: 'https://github.com/anthropics/anthropic-tools',
    license: 'MIT',
    version: '1.0.0',
    tags: ['architecture', 'design', 'distributed', 'rfc', 'diagrams'],
    triggers: ['system design', 'architecture', 'rfc', 'high level design', 'scale architecture'],
    tools: ['read_file', 'write_file', 'search_code', 'codegraph'],
    content: `---
name: system-architect
description: High-level distributed architecture design, RFC drafting, data flow diagrams, and trade-off analysis.
version: 1.0.0
author: Anthropic Claude Code Standards & Community
upstream: https://github.com/anthropics/anthropic-tools
license: MIT
tags: [architecture, design, distributed, rfc, diagrams]
triggers: [system design, architecture, rfc, high level design, scale architecture]
tools: [read_file, write_file, search_code, codegraph]
---

# System Architect

## When to use
Use when designing new subsystems, evaluating major architectural trade-offs, architecting microservices, drafting RFCs, or mapping system-wide data flows.

## Process

1. **Context & Problem Statement**:
   - Understand functional requirements, SLA/SLO expectations, and traffic/scale parameters.
   - Map existing systems and dependencies using \`codegraph\` and file inspection.

2. **Core Decisions & Trade-off Matrix**:
   - Compare 2-3 architectural approaches across latency, complexity, fault tolerance, and developer velocity.
   - Clearly identify CAP theorem trade-offs and consistency requirements (eventual vs strong).

3. **Data Flow & Interfaces**:
   - Produce clear ASCII or Mermaid flowcharts documenting synchronous vs asynchronous message queues.
   - Define exact API boundaries and database schemas before writing implementation code.

4. **Failure Modes & Resiliency**:
   - Document circuit breakers, retry policies, backoff strategies, and dead letter queues.
`,
  },
  {
    id: 'api-designer',
    name: 'API Designer',
    description:
      'RESTful, GraphQL, and gRPC contract design following OpenAPI 3.1 and standard schema conventions.',
    category: 'Architecture',
    author: 'OpenAPI Initiative & Community',
    upstreamUrl: 'https://github.com/OAI/OpenAPI-Specification',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['api', 'rest', 'graphql', 'openapi', 'contracts'],
    triggers: ['api design', 'rest api', 'graphql schema', 'endpoint design', 'openapi'],
    tools: ['read_file', 'write_file', 'search_code'],
    content: `---
name: api-designer
description: RESTful, GraphQL, and gRPC contract design following OpenAPI 3.1 and standard schema conventions.
version: 1.0.0
author: OpenAPI Initiative & Community
upstream: https://github.com/OAI/OpenAPI-Specification
license: Apache-2.0
tags: [api, rest, graphql, openapi, contracts]
triggers: [api design, rest api, graphql schema, endpoint design, openapi]
tools: [read_file, write_file, search_code]
---

# API Designer

## When to use
Use when creating, standardizing, or refactoring HTTP REST, GraphQL, or RPC interfaces, ensuring idiomatic error codes, pagination, and schema versioning.

## Design Rules

1. **REST Resource Modeling**:
   - Use plural nouns for resources (\`/api/v1/orders\`, not \`/api/v1/getOrder\`).
   - Use standard HTTP status codes: \`201 Created\` with \`Location\`, \`204 No Content\`, \`400 Bad Request\`, \`404 Not Found\`, \`409 Conflict\`.

2. **Idempotency & Pagination**:
   - Enforce cursor-based pagination (\`limit\`, \`starting_after\`) for scalable datasets.
   - Support \`Idempotency-Key\` headers on mutating POST requests.

3. **Structured Errors**:
   - Uniform error envelope: \`{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "details": [] } }\`.
`,
  },
  {
    id: 'database-schema',
    name: 'Database Schema & Migrations',
    description:
      'Relational (PostgreSQL) and NoSQL schema design, indexing strategies, and non-blocking migration scripts.',
    category: 'Architecture',
    author: 'PostgreSQL Community & Open Source Contributors',
    upstreamUrl: 'https://github.com/postgres/postgres',
    license: 'MIT',
    version: '1.0.0',
    tags: ['database', 'postgres', 'sql', 'migrations', 'indexing'],
    triggers: ['database schema', 'sql migration', 'add index', 'table design', 'postgres'],
    tools: ['read_file', 'write_file', 'run_command'],
    content: `---
name: database-schema
description: Relational (PostgreSQL) and NoSQL schema design, indexing strategies, and non-blocking migration scripts.
version: 1.0.0
author: PostgreSQL Community & Open Source Contributors
upstream: https://github.com/postgres/postgres
license: MIT
tags: [database, postgres, sql, migrations, indexing]
triggers: [database schema, sql migration, add index, table design, postgres]
tools: [read_file, write_file, run_command]
---

# Database Schema & Migrations

## When to use
Use when designing tables, writing schema migrations, choosing foreign key cascades, or adding indexes for high-throughput databases.

## Standards

1. **Zero-Downtime Migrations**:
   - In PostgreSQL, always use \`CREATE INDEX CONCURRENTLY\`.
   - Never run \`ALTER TABLE ... ADD COLUMN ... DEFAULT ...\` with volatile functions on large tables.
   - Use multi-step migrations for column renames: add new column -> dual write -> backfill -> read new -> drop old.

2. **Data Integrity & Types**:
   - Prefer \`TIMESTAMPTZ\` over \`TIMESTAMP\`.
   - Use UUIDv7 or BIGINT IDENTITY for sequential scalable primary keys.
   - Add NOT NULL constraints with defaults carefully.
`,
  },
  {
    id: 'playwright-e2e',
    name: 'Playwright E2E Testing',
    description:
      'Resilient end-to-end browser automation with Page Object models, network mocking, and CI fixtures.',
    category: 'Testing',
    author: 'Microsoft Playwright Community',
    upstreamUrl: 'https://github.com/microsoft/playwright',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['playwright', 'testing', 'e2e', 'browser', 'automation'],
    triggers: ['playwright', 'e2e test', 'end to end test', 'browser test'],
    tools: ['read_file', 'write_file', 'run_command'],
    content: `---
name: playwright-e2e
description: Resilient end-to-end browser automation with Page Object models, network mocking, and CI fixtures.
version: 1.0.0
author: Microsoft Playwright Community
upstream: https://github.com/microsoft/playwright
license: Apache-2.0
tags: [playwright, testing, e2e, browser, automation]
triggers: [playwright, e2e test, end to end test, browser test]
tools: [read_file, write_file, run_command]
---

# Playwright E2E Testing

## When to use
Use when authoring or debugging browser-based end-to-end tests, mocking third-party network APIs, or diagnosing flaky UI suites.

## Best Practices

1. **User-Facing Locators**:
   - Use \`page.getByRole()\`, \`page.getByLabel()\`, and \`page.getByText()\`. Avoid fragile XPath or CSS selectors.
   - Assert with web-first assertions: \`await expect(locator).toBeVisible()\`.

2. **Page Object Models**:
   - Encapsulate page navigation and selector knowledge into dedicated Page classes.
   - Keep assertions in test files, methods returning promises in page objects.

3. **Network Isolation**:
   - Mock external SaaS and payment gateways using \`page.route('**/api/v1/checkout', route => ...)\`.
`,
  },
  {
    id: 'mutation-tester',
    name: 'Mutation Testing',
    description:
      'Mutation testing workflows to expose silent test suite gaps and assert true test quality.',
    category: 'Testing',
    author: 'Stryker Mutator Community',
    upstreamUrl: 'https://github.com/stryker-mutator/stryker-js',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['testing', 'mutation', 'stryker', 'coverage', 'quality'],
    triggers: ['mutation test', 'stryker', 'test effectiveness', 'surviving mutants'],
    tools: ['read_file', 'run_command'],
    content: `---
name: mutation-tester
description: Mutation testing workflows to expose silent test suite gaps and assert true test quality.
version: 1.0.0
author: Stryker Mutator Community
upstream: https://github.com/stryker-mutator/stryker-js
license: Apache-2.0
tags: [testing, mutation, stryker, coverage, quality]
triggers: [mutation test, stryker, test effectiveness, surviving mutants]
tools: [read_file, run_command]
---

# Mutation Testing

## When to use
Use when standard code coverage is high (80%+) but you suspect tests lack real assertions or fail to catch subtle regressions.

## Workflow

1. **Understand Mutants**:
   - Mutants invert conditions (\`>\` to \`<=\`), drop statements, or replace returns with null.
   - A mutant is **killed** if at least one unit test fails. A mutant **survives** if all tests pass.

2. **Analyze Surviving Mutants**:
   - If a mutant in core business logic survived, the test suite is missing a negative test or boundary assertion.
   - Add targeted tests specifically designed to kill the surviving mutant.
`,
  },
  {
    id: 'test-driven-development',
    name: 'Test-Driven Development (TDD)',
    description:
      'Enforces strict Red-Green-Refactor cycles: write the failing test first before implementation.',
    category: 'Testing',
    author: 'Kent Beck & Agile Community',
    upstreamUrl: 'https://github.com/clean-code-craftsmanship',
    license: 'MIT',
    version: '1.0.0',
    tags: ['tdd', 'testing', 'unit-tests', 'red-green-refactor'],
    triggers: ['tdd', 'test driven', 'write tests first', 'red green refactor'],
    tools: ['read_file', 'write_file', 'edit_file', 'run_command'],
    content: `---
name: test-driven-development
description: Enforces strict Red-Green-Refactor cycles: write the failing test first before implementation.
version: 1.0.0
author: Kent Beck & Agile Community
upstream: https://github.com/clean-code-craftsmanship
license: MIT
tags: [tdd, testing, unit-tests, red-green-refactor]
triggers: [tdd, test driven, write tests first, red green refactor]
tools: [read_file, write_file, edit_file, run_command]
---

# Test-Driven Development (TDD)

## When to use
Use for all non-trivial logic: bugfixes, new modules, parsers, algorithms, and state machines.

## The Cycle

1. **Red**: Write a single, focused test asserting the required behavior. Run tests to confirm it fails for the expected reason.
2. **Green**: Write the minimal code necessary to make the test pass. Do not write premature features.
3. **Refactor**: Clean up duplication, clarify variable names, and streamline logic while keeping all tests passing.
`,
  },
  {
    id: 'owasp-guard',
    name: 'OWASP Security Guard',
    description:
      'Automated threat modeling, OWASP Top 10 prevention, sanitization, and CSP/CORS audits.',
    category: 'Security',
    author: 'OWASP Foundation & Contributors',
    upstreamUrl: 'https://github.com/OWASP/CheatSheetSeries',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['security', 'owasp', 'audit', 'xss', 'sql-injection', 'csp'],
    triggers: ['owasp', 'security vulnerability', 'xss check', 'injection check', 'threat model'],
    tools: ['read_file', 'search_code', 'run_command'],
    content: `---
name: owasp-guard
description: Automated threat modeling, OWASP Top 10 prevention, sanitization, and CSP/CORS audits.
version: 1.0.0
author: OWASP Foundation & Contributors
upstream: https://github.com/OWASP/CheatSheetSeries
license: Apache-2.0
tags: [security, owasp, audit, xss, sql-injection, csp]
triggers: [owasp, security vulnerability, xss check, injection check, threat model]
tools: [read_file, search_code, run_command]
---

# OWASP Security Guard

## When to use
Use when auditing code for vulnerabilities, validating user input sanitizers, verifying authentication cookies, or setting up CSP headers.

## Checklist

1. **Injection Prevention**:
   - Parameterized queries only. No string concatenation in SQL or shell executions.
2. **Cross-Site Scripting (XSS)**:
   - Context-aware HTML escaping. Avoid \`dangerouslySetInnerHTML\` or direct \`innerHTML\` without sanitizers (DOMPurify).
3. **Security Headers**:
   - Strict Content-Security-Policy (CSP), \`X-Frame-Options: DENY\`, \`X-Content-Type-Options: nosniff\`.
   - Cookies must have \`HttpOnly; Secure; SameSite=Strict\`.
`,
  },
  {
    id: 'dependency-auditor',
    name: 'Dependency Auditor',
    description:
      'Audit supply chain dependencies, CVE checking, lockfile inspection, and open-source license compliance.',
    category: 'Security',
    author: 'Open Source Security Foundation (OpenSSF)',
    upstreamUrl: 'https://github.com/ossf',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['security', 'dependencies', 'cve', 'npm-audit', 'licenses'],
    triggers: ['dependency audit', 'npm audit', 'vulnerable package', 'cve check', 'license audit'],
    tools: ['read_file', 'run_command'],
    content: `---
name: dependency-auditor
description: Audit supply chain dependencies, CVE checking, lockfile inspection, and open-source license compliance.
version: 1.0.0
author: Open Source Security Foundation (OpenSSF)
upstream: https://github.com/ossf
license: Apache-2.0
tags: [security, dependencies, cve, npm-audit, licenses]
triggers: [dependency audit, npm audit, vulnerable package, cve check, license audit]
tools: [read_file, run_command]
---

# Dependency Auditor

## When to use
Use during release prep or dependency upgrades to detect known CVEs, malicious packages, or GPL license leaks in commercial codebases.

## Procedure

1. **Vulnerability Scan**:
   - Run package manager audit (\`npm audit\`, \`cargo audit\`, \`pip-audit\`).
   - Distinguish direct dependencies from transitive dependencies.

2. **Patch & Mitigation**:
   - Upgrade to non-vulnerable patch versions.
   - If upstream is unmaintained, configure overrides/resolutions or replace the library.
`,
  },
  {
    id: 'code-review-critic',
    name: 'Code Review Critic',
    description:
      'Strict, objective peer-review checklist assessing race conditions, edge cases, algorithmic complexity, and idiomatic style.',
    category: 'Refactoring',
    author: 'Anthropic Claude Code Standards & Community',
    upstreamUrl: 'https://github.com/anthropics/anthropic-tools',
    license: 'MIT',
    version: '1.0.0',
    tags: ['review', 'code-review', 'critique', 'quality', 'best-practices'],
    triggers: ['code review', 'review this pr', 'critique code', 'check my diff'],
    tools: ['read_file', 'search_code', 'run_command'],
    content: `---
name: code-review-critic
description: Strict, objective peer-review checklist assessing race conditions, edge cases, algorithmic complexity, and idiomatic style.
version: 1.0.0
author: Anthropic Claude Code Standards & Community
upstream: https://github.com/anthropics/anthropic-tools
license: MIT
tags: [review, code-review, critique, quality, best-practices]
triggers: [code review, review this pr, critique code, check my diff]
tools: [read_file, search_code, run_command]
---

# Code Review Critic

## When to use
Use to perform a thorough, constructive code review before merging changes or committing pull requests.

## Review Dimensions

1. **Correctness & Edge Cases**:
   - Null / undefined checks, array out-of-bounds, empty collections, NaN math.
   - Concurrency bugs: race conditions, unhandled promise rejections, missing locks.

2. **Performance & Complexity**:
   - Algorithmic complexity ($O(N^2)$ nested loops, memory leaks, unbounded caches).
   - Database query N+1 patterns.

3. **Maintainability & Test Coverage**:
   - Clear naming, single responsibility, and comprehensive unit tests for new paths.
`,
  },
  {
    id: 'legacy-refactorer',
    name: 'Legacy Code Refactorer',
    description:
      'Safe incremental modernization using characterization tests and strangler-fig migration patterns.',
    category: 'Refactoring',
    author: 'Martin Fowler & Clean Architecture Community',
    upstreamUrl: 'https://martinfowler.com',
    license: 'MIT',
    version: '1.0.0',
    tags: ['refactoring', 'legacy', 'strangler-fig', 'characterization-tests'],
    triggers: ['refactor legacy', 'modernize code', 'characterization test', 'clean up legacy'],
    tools: ['read_file', 'write_file', 'edit_file', 'run_command'],
    content: `---
name: legacy-refactorer
description: Safe incremental modernization using characterization tests and strangler-fig migration patterns.
version: 1.0.0
author: Martin Fowler & Clean Architecture Community
upstream: https://martinfowler.com
license: MIT
tags: [refactoring, legacy, strangler-fig, characterization-tests]
triggers: [refactor legacy, modernize code, characterization test, clean up legacy]
tools: [read_file, write_file, edit_file, run_command]
---

# Legacy Code Refactorer

## When to use
Use when updating, decoupling, or modernizing untested, tightly coupled legacy code without breaking existing functionality.

## Incremental Method

1. **Characterization Tests**:
   - Write tests that capture the current *actual* behavior of the code (including quirks/bugs), providing a safety net.
2. **Break Dependencies**:
   - Introduce interfaces or adapter layers around external dependencies (databases, third-party APIs).
3. **Small Atomic Commits**:
   - Refactor in steps of 10-30 lines. Run the test suite after every single step.
`,
  },
  {
    id: 'docker-packager',
    name: 'Docker Packager',
    description:
      'Production multi-stage Dockerfiles, minimal distroless runtimes, layer caching, and non-root users.',
    category: 'DevOps',
    author: 'Docker Community & CNCF',
    upstreamUrl: 'https://github.com/docker/docker-ce',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['docker', 'container', 'devops', 'distroless', 'multi-stage'],
    triggers: ['dockerfile', 'docker build', 'containerize', 'optimize docker image'],
    tools: ['read_file', 'write_file', 'run_command'],
    content: `---
name: docker-packager
description: Production multi-stage Dockerfiles, minimal distroless runtimes, layer caching, and non-root users.
version: 1.0.0
author: Docker Community & CNCF
upstream: https://github.com/docker/docker-ce
license: Apache-2.0
tags: [docker, container, devops, distroless, multi-stage]
triggers: [dockerfile, docker build, containerize, optimize docker image]
tools: [read_file, write_file, run_command]
---

# Docker Packager

## When to use
Use when authoring or optimizing Dockerfiles, minimizing image size, improving build cache hit rates, or hardening containers.

## Best Practices

1. **Multi-Stage Builds**:
   - Stage 1: Build & compile with full toolchain.
   - Stage 2: Copy only production artifacts into minimal runtime (Alpine or Google Distroless).

2. **Cache Layer Ordering**:
   - Copy \`package*.json\` / \`Cargo.toml\` and install dependencies before copying source code.

3. **Security Standards**:
   - Never run as \`root\`. Use \`USER node\` or create an unprivileged user.
   - Exclude secrets with \`.dockerignore\` (\`.env\`, \`.git\`, credentials).
`,
  },
  {
    id: 'github-actions-ci',
    name: 'GitHub Actions CI/CD',
    description:
      'Matrix CI/CD workflows, automated testing, releases, dependency caching, and environment secret handling.',
    category: 'DevOps',
    author: 'GitHub Actions Community',
    upstreamUrl: 'https://github.com/actions',
    license: 'MIT',
    version: '1.0.0',
    tags: ['github-actions', 'ci', 'cd', 'workflows', 'automation'],
    triggers: ['github actions', 'ci cd workflow', 'pipeline setup', 'action yaml'],
    tools: ['read_file', 'write_file', 'run_command'],
    content: `---
name: github-actions-ci
description: Matrix CI/CD workflows, automated testing, releases, dependency caching, and environment secret handling.
version: 1.0.0
author: GitHub Actions Community
upstream: https://github.com/actions
license: MIT
tags: [github-actions, ci, cd, workflows, automation]
triggers: [github actions, ci cd workflow, pipeline setup, action yaml]
tools: [read_file, write_file, run_command]
---

# GitHub Actions CI/CD

## When to use
Use when writing or optimizing \`.github/workflows/*.yml\` for automated testing, linting, matrix builds, or automated releases.

## Core Rules

1. **Concurrency & Ceilings**:
   - Add \`concurrency\` groups with \`cancel-in-progress: true\` to avoid wasted runner time on outdated PR commits.
   - Set explicit \`timeout-minutes\` on every job and critical step.

2. **Dependency Caching**:
   - Use built-in cache keys on \`actions/setup-node\` or \`actions/cache\` to speed up runner execution.

3. **Least Privilege Permissions**:
   - Explicitly declare \`permissions:\` per workflow or job (e.g. \`contents: read\`).
`,
  },
  {
    id: 'git-workflow-pro',
    name: 'Git Workflow Pro',
    description:
      'Conventional commits, atomic branch rebasing, merge conflict resolution, and PR templates.',
    category: 'Git & Workflow',
    author: 'Conventional Commits Community',
    upstreamUrl: 'https://github.com/conventional-commits/conventionalcommits.org',
    license: 'MIT',
    version: '1.0.0',
    tags: ['git', 'workflow', 'conventional-commits', 'rebase', 'pull-requests'],
    triggers: ['git workflow', 'commit message', 'git rebase', 'merge conflict'],
    tools: ['read_file', 'run_command'],
    content: `---
name: git-workflow-pro
description: Conventional commits, atomic branch rebasing, merge conflict resolution, and PR templates.
version: 1.0.0
author: Conventional Commits Community
upstream: https://github.com/conventional-commits/conventionalcommits.org
license: MIT
tags: [git, workflow, conventional-commits, rebase, pull-requests]
triggers: [git workflow, commit message, git rebase, merge conflict]
tools: [read_file, run_command]
---

# Git Workflow Pro

## When to use
Use when drafting commit messages, structuring branch history, performing interactive rebases, or resolving merge conflicts cleanly.

## Conventional Commits

- \`feat: <summary>\`: New functionality
- \`fix: <summary>\`: Bug fix
- \`refactor: <summary>\`: Code change that neither fixes a bug nor adds a feature
- \`test: <summary>\`: Adding or correcting tests
- \`docs: <summary>\`: Documentation only

## Safe Git Habits

1. Make atomic commits: one logical concern per commit.
2. Rebase onto main instead of merge commits for clean linear history: \`git pull --rebase origin main\`.
3. Never force-push to shared branches without \`--force-with-lease\`.
`,
  },
  {
    id: 'changelog-generator',
    name: 'Changelog Generator',
    description:
      'Keep-a-Changelog markdown synchronization from git history and semantic version tagging.',
    category: 'Git & Workflow',
    author: 'Keep a Changelog & Olivier Lacan',
    upstreamUrl: 'https://github.com/olivierlacan/keep-a-changelog',
    license: 'MIT',
    version: '1.0.0',
    tags: ['changelog', 'release-notes', 'semver', 'git-history'],
    triggers: ['changelog', 'generate release notes', 'update changelog', 'keep a changelog'],
    tools: ['read_file', 'write_file', 'run_command'],
    content: `---
name: changelog-generator
description: Keep-a-Changelog markdown synchronization from git history and semantic version tagging.
version: 1.0.0
author: Keep a Changelog & Olivier Lacan
upstream: https://github.com/olivierlacan/keep-a-changelog
license: MIT
tags: [changelog, release-notes, semver, git-history]
triggers: [changelog, generate release notes, update changelog, keep a changelog]
tools: [read_file, write_file, run_command]
---

# Changelog Generator

## When to use
Use when preparing a version release, syncing CHANGELOG.md with recent commits, and generating GitHub release notes.

## Structure (Keep a Changelog Standard)

Categorize changes under:
- **Added**: for new features.
- **Changed**: for changes in existing functionality.
- **Deprecated**: for soon-to-be removed features.
- **Removed**: for now removed features.
- **Fixed**: for any bug fixes.
- **Security**: in case of vulnerabilities.
`,
  },
  {
    id: 'web-vitals-optimizer',
    name: 'Web Vitals & Performance',
    description:
      'Core Web Vitals optimization, bundle size trimming, code splitting, and memory leak analysis.',
    category: 'Performance',
    author: 'Google Web.dev & Chromium Community',
    upstreamUrl: 'https://github.com/GoogleChrome/web-vitals',
    license: 'Apache-2.0',
    version: '1.0.0',
    tags: ['performance', 'web-vitals', 'lcp', 'cls', 'bundle-size'],
    triggers: [
      'web vitals',
      'optimize performance',
      'reduce bundle size',
      'lcp cls',
      'speed up web',
    ],
    tools: ['read_file', 'run_command'],
    content: `---
name: web-vitals-optimizer
description: Core Web Vitals optimization, bundle size trimming, code splitting, and memory leak analysis.
version: 1.0.0
author: Google Web.dev & Chromium Community
upstream: https://github.com/GoogleChrome/web-vitals
license: Apache-2.0
tags: [performance, web-vitals, lcp, cls, bundle-size]
triggers: [web vitals, optimize performance, reduce bundle size, lcp cls, speed up web]
tools: [read_file, run_command]
---

# Web Vitals & Performance

## When to use
Use when auditing web applications for loading speed, responsiveness, Core Web Vitals (LCP, INP, CLS), and bundle bloat.

## Core Metrics

1. **LCP (Largest Contentful Paint)**:
   - Target: < 2.5s.
   - Preload critical hero images with \`<link rel="preload">\`.
   - Minimize render-blocking CSS/JS.

2. **INP (Interaction to Next Paint)**:
   - Target: < 200ms.
   - Break long tasks on the main thread using \`requestIdleCallback\` or web workers.

3. **CLS (Cumulative Layout Shift)**:
   - Target: < 0.1.
   - Always set explicit \`width\` and \`height\` on images and video embeds.
`,
  },
];
