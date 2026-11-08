---
name: test-driven-development
description: Implement a change test-first: failing test, minimal implementation, then refactor with the suite green.
version: 1.0.0
author: Mugil IDE
tags: testing, tdd, quality
triggers: test driven, write tests first, add tests for
tools: read_file, write_file, edit_file, run_command
---

# Test-Driven Development

## When to use

The user asks for a new behaviour to be implemented with tests, or asks to add
tests for existing code.

## Steps

1. **Locate the test suite.** Find the existing runner and its conventions
   (`package.json` scripts, `jest.config`, `pytest.ini`, `go test`, …). Reuse
   the existing test file for the module when one exists.
2. **Write one failing test** that states the new behaviour in its name. Run
   only that test and confirm it fails *for the expected reason* (not a typo
   or a missing import).
3. **Implement the minimum** that makes it pass. No speculative options, no
   abstractions with a single caller.
4. **Run the whole suite**, not just the new test — a green single test with a
   red suite is not done.
5. **Refactor** only while the suite is green, then re-run.

## Rules

- Never change a test's assertion to make an implementation pass unless the
  assertion itself was wrong; say so explicitly when it was.
- Report the exact command used to run the tests.
- If a pre-existing test fails, report it as a separate finding instead of
  silently fixing it in the same change.
