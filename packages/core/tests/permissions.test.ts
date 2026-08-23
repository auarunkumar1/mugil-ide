import {
  applyPermissionOverrides,
  createPermissionCheck,
  defaultPolicyForMode,
  patternToRegExp,
  resolveToolPermission,
  type PermissionPolicy,
} from '../src/modules/tools/permissions.js';
import type { ToolCall } from '../src/types.js';

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, arguments: JSON.stringify(args) };
}

describe('resolveToolPermission', () => {
  it('allows everything when no policy is given', () => {
    expect(resolveToolPermission(undefined, call('write_file'))).toBe('allow');
  });

  it('applies per-tool actions and defaults unknown tools to allow', () => {
    const policy: PermissionPolicy = { tools: { write_file: 'deny', edit_file: 'ask' } };
    expect(resolveToolPermission(policy, call('write_file'))).toBe('deny');
    expect(resolveToolPermission(policy, call('edit_file'))).toBe('ask');
    expect(resolveToolPermission(policy, call('read_file'))).toBe('allow');
  });

  it('plan mode is read-only: writes, edits and commands are denied', () => {
    const policy = defaultPolicyForMode('plan');
    expect(resolveToolPermission(policy, call('read_file'))).toBe('allow');
    expect(resolveToolPermission(policy, call('list_files'))).toBe('allow');
    expect(resolveToolPermission(policy, call('codegraph'))).toBe('allow');
    expect(resolveToolPermission(policy, call('write_file'))).toBe('deny');
    expect(resolveToolPermission(policy, call('edit_file'))).toBe('deny');
    expect(resolveToolPermission(policy, call('todowrite'))).toBe('deny');
    expect(resolveToolPermission(policy, call('run_command', { command: 'npm test' }))).toBe('deny');
  });

  it('act mode asks for writes, edits, todo writes and commands', () => {
    const policy = defaultPolicyForMode('act');
    expect(resolveToolPermission(policy, call('read_file'))).toBe('allow');
    expect(resolveToolPermission(policy, call('write_file'))).toBe('ask');
    expect(resolveToolPermission(policy, call('edit_file'))).toBe('ask');
    expect(resolveToolPermission(policy, call('todowrite'))).toBe('ask');
    expect(resolveToolPermission(policy, call('run_command', { command: 'npm test' }))).toBe('ask');
  });

  it('bash command rules match with last-rule-wins semantics', () => {
    const policy: PermissionPolicy = {
      tools: { run_command: 'deny' },
      bash: {
        defaultAction: 'ask',
        rules: [
          { pattern: '*', action: 'ask' },
          { pattern: 'git status*', action: 'allow' },
        ],
      },
    };
    expect(resolveToolPermission(policy, call('run_command', { command: 'git status' }))).toBe('allow');
    expect(resolveToolPermission(policy, call('run_command', { command: 'git status -s' }))).toBe('allow');
    expect(resolveToolPermission(policy, call('run_command', { command: 'git push origin main' }))).toBe('ask');
    expect(resolveToolPermission(policy, call('run_command', { command: 'rm -rf .' }))).toBe('ask');
  });

  it('a bash defaultAction can deny every command', () => {
    const policy: PermissionPolicy = { bash: { defaultAction: 'deny' } };
    expect(resolveToolPermission(policy, call('run_command', { command: 'npm test' }))).toBe('deny');
  });
});

describe('patternToRegExp', () => {
  it('turns glob-ish patterns into anchored regexes', () => {
    expect(patternToRegExp('git *').test('git status')).toBe(true);
    expect(patternToRegExp('git *').test('status git')).toBe(false);
    expect(patternToRegExp('git push').test('git push origin main')).toBe(false);
    expect(patternToRegExp('*').test('anything at all')).toBe(true);
    expect(patternToRegExp('npm run *').test('npm run typecheck')).toBe(true);
  });
});

describe('applyPermissionOverrides', () => {
  it('applies per-tool overrides on top of mode defaults without mutating the base', () => {
    const base = defaultPolicyForMode('act');
    const merged = applyPermissionOverrides(base, { write_file: 'allow' });
    expect(resolveToolPermission(merged, call('write_file'))).toBe('allow');
    expect(resolveToolPermission(merged, call('edit_file'))).toBe('ask'); // untouched
    // The base policy is unchanged.
    expect(resolveToolPermission(base, call('write_file'))).toBe('ask');
  });

  it('maps run_command overrides to the bash defaultAction', () => {
    const merged = applyPermissionOverrides(defaultPolicyForMode('act'), { run_command: 'allow' });
    expect(resolveToolPermission(merged, call('run_command', { command: 'npm test' }))).toBe('allow');
    const denied = applyPermissionOverrides(defaultPolicyForMode('act'), { run_command: 'deny' });
    expect(resolveToolPermission(denied, call('run_command', { command: 'npm test' }))).toBe('deny');
  });

  it('lets plan mode be relaxed to ask per tool', () => {
    const merged = applyPermissionOverrides(defaultPolicyForMode('plan'), { edit_file: 'ask' });
    expect(resolveToolPermission(merged, call('edit_file'))).toBe('ask');
    expect(resolveToolPermission(merged, call('write_file'))).toBe('deny'); // untouched
    expect(resolveToolPermission(merged, call('run_command', { command: 'ls' }))).toBe('deny');
  });

  it('returns a policy with the same behavior for empty overrides', () => {
    const base = defaultPolicyForMode('act');
    const merged = applyPermissionOverrides(base, {});
    for (const name of ['write_file', 'edit_file', 'todowrite', 'run_command', 'read_file']) {
      expect(resolveToolPermission(merged, call(name, { command: 'x' }))).toBe(
        resolveToolPermission(base, call(name, { command: 'x' })),
      );
    }
  });
});

describe('createPermissionCheck', () => {
  it('returns true for allow and false for deny', () => {
    const check = createPermissionCheck(defaultPolicyForMode('plan'));
    expect(check(call('read_file'))).toBe(true);
    expect(check(call('write_file'))).toBe(false);
  });

  it('delegates ask actions to the onAsk handler', async () => {
    const onAsk = jest.fn().mockResolvedValue(true);
    const check = createPermissionCheck(defaultPolicyForMode('act'), onAsk);
    expect(check(call('read_file'))).toBe(true);
    await expect(check(call('write_file'))).resolves.toBe(true);
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('treats ask as deny when no handler is provided (headless safety)', () => {
    const check = createPermissionCheck(defaultPolicyForMode('act'));
    expect(check(call('write_file'))).toBe(false);
    expect(check(call('run_command', { command: 'npm test' }))).toBe(false);
  });
});

describe('plan/act mode semantics', () => {
  it('plan mode denies all write tools without prompting', () => {
    const policy = defaultPolicyForMode('plan');
    const writeTools = ['write_file', 'edit_file', 'apply_patch', 'todowrite'];
    for (const tool of writeTools) {
      expect(resolveToolPermission(policy, call(tool))).toBe('deny');
    }
    expect(resolveToolPermission(policy, call('run_command', { command: 'ls' }))).toBe('deny');
  });

  it('plan mode allows all read tools', () => {
    const policy = defaultPolicyForMode('plan');
    const readTools = ['read_file', 'list_files', 'search_code', 'codegraph', 'todoread', 'skill', 'webfetch', 'websearch', 'lsp'];
    for (const tool of readTools) {
      expect(resolveToolPermission(policy, call(tool))).toBe('allow');
    }
  });

  it('act mode asks for write tools', () => {
    const policy = defaultPolicyForMode('act');
    const writeTools = ['write_file', 'edit_file', 'apply_patch', 'todowrite'];
    for (const tool of writeTools) {
      expect(resolveToolPermission(policy, call(tool))).toBe('ask');
    }
  });

  it('act mode allows read tools', () => {
    const policy = defaultPolicyForMode('act');
    const readTools = ['read_file', 'list_files', 'search_code', 'codegraph', 'todoread', 'skill', 'webfetch', 'websearch', 'lsp'];
    for (const tool of readTools) {
      expect(resolveToolPermission(policy, call(tool))).toBe('allow');
    }
  });

  it('plan mode denies mcp_ prefix tools', () => {
    const policy = defaultPolicyForMode('plan');
    expect(resolveToolPermission(policy, call('mcp__web__fetch'))).toBe('deny');
    expect(resolveToolPermission(policy, call('mcp__server__tool'))).toBe('deny');
  });

  it('act mode asks for mcp_ prefix tools', () => {
    const policy = defaultPolicyForMode('act');
    expect(resolveToolPermission(policy, call('mcp__web__fetch'))).toBe('ask');
  });
});
