import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkspaceTools, parsePatch, parsePatchHunks } from '../src/modules/tools/workspaceTools.js';
import { undoLast } from '../src/modules/undo.js';
import type { ToolCall } from '../src/types.js';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-patch-'));
}

const patchCall = (patch: string): ToolCall => ({ id: 'p1', name: 'apply_patch', arguments: JSON.stringify({ patch }) });

const questionCall = (args: Record<string, unknown>): ToolCall => ({
  id: 'q1',
  name: 'question',
  arguments: JSON.stringify(args),
});

describe('parsePatch', () => {
  it('parses add/update/delete directives with bodies', () => {
    const directives = parsePatch(
      [
        '*** Add File: src/new.ts',
        'export const a = 1;',
        '*** Update File: src/a.ts',
        '@@',
        '-old',
        '+new',
        '*** Delete File: src/old.ts',
      ].join('\n'),
    );
    expect(directives.map((d) => d.kind)).toEqual(['add', 'update', 'delete']);
    expect(directives[0]!.body).toEqual(['export const a = 1;']);
    expect(directives[1]!.body).toEqual(['@@', '-old', '+new']);
  });

  it('attaches Move to: to the preceding empty update', () => {
    const directives = parsePatch('*** Update File: src/a.ts\n*** Move to: src/b.ts');
    expect(directives).toHaveLength(1);
    expect(directives[0]!.kind).toBe('update');
    expect(directives[0]!.moveTo).toBe('src/b.ts');
  });
});

describe('parsePatchHunks', () => {
  it('separates removed/added lines and keeps context in both', () => {
    const hunks = parsePatchHunks(['@@', '-old', '+new', ' same']);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.before).toEqual(['old', 'same']);
    expect(hunks[0]!.after).toEqual(['new', 'same']);
  });

  it('parses multiple hunks', () => {
    const hunks = parsePatchHunks(['@@', '-a', '+b', '@@', '-c', '+d']);
    expect(hunks).toHaveLength(2);
  });
});

describe('apply_patch executor', () => {
  it('adds, updates, and deletes files in one patch', async () => {
    const root = tempRoot();
    const target = path.join(root, 'src', 'a.ts');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(target, 'const x = 1;\nconst keep = true;\n');
    fs.writeFileSync(path.join(root, 'src', 'old.ts'), 'export const old = true;\n');
    const { toolRegistry } = createWorkspaceTools(root);

    const out = await toolRegistry.apply_patch(
      patchCall(
        [
          '*** Add File: src/new.ts',
          'export const b = 2;',
          '*** Update File: src/a.ts',
          '@@',
          '-const x = 1;',
          '+const x = 99;',
          '*** Delete File: src/old.ts',
        ].join('\n'),
      ),
    );
    expect(out).toContain('Added src/new.ts');
    expect(out).toContain('Updated src/a.ts');
    expect(out).toContain('Deleted src/old.ts');

    expect(fs.readFileSync(path.join(root, 'src', 'new.ts'), 'utf-8')).toBe('export const b = 2;\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('const x = 99;\nconst keep = true;\n');
    expect(fs.existsSync(path.join(root, 'src', 'old.ts'))).toBe(false);
  });

  it('rejects non-unique hunk matches', async () => {
    const root = tempRoot();
    const target = path.join(root, 'a.txt');
    fs.writeFileSync(target, 'dup\ndup\n');
    const { toolRegistry } = createWorkspaceTools(root);
    const out = await toolRegistry.apply_patch(
      patchCall(['*** Update File: a.txt', '@@', '-dup', '+unique'].join('\n')),
    );
    expect(out).toContain('matches 2 times');
    expect(fs.readFileSync(target, 'utf-8')).toBe('dup\ndup\n'); // untouched
  });

  it('moves a file via Update + Move to', async () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'a.txt'), 'content');
    const { toolRegistry } = createWorkspaceTools(root);
    const out = await toolRegistry.apply_patch(
      patchCall('*** Update File: a.txt\n*** Move to: b.txt'),
    );
    expect(out).toContain('Moved a.txt → b.txt');
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf-8')).toBe('content');
  });

  it('enforces workspace containment and validates input', async () => {
    const root = tempRoot();
    const { toolRegistry } = createWorkspaceTools(root);
    expect(
      await toolRegistry.apply_patch(patchCall('*** Add File: ../escape.txt\nx')),
    ).toContain('outside the workspace');
    expect(await toolRegistry.apply_patch(patchCall('no directives here'))).toContain(
      'empty patch',
    );
    fs.writeFileSync(path.join(root, 'a.txt'), 'existing\n');
    expect(
      await toolRegistry.apply_patch(
        patchCall(['*** Update File: a.txt', '@@', '+only-added'].join('\n')),
      ),
    ).toContain('no context or removed lines');
  });

  it('records undoable edits (apply_patch → /undo restores)', async () => {
    const root = tempRoot();
    const target = path.join(root, 'a.txt');
    fs.writeFileSync(target, 'before\n');
    const { toolRegistry } = createWorkspaceTools(root);
    await toolRegistry.apply_patch(
      patchCall(['*** Update File: a.txt', '@@', '-before', '+after'].join('\n')),
    );
    expect(fs.readFileSync(target, 'utf-8')).toBe('after\n');
    const undone = undoLast(root)!;
    expect(undone.path).toBe('a.txt');
    expect(fs.readFileSync(target, 'utf-8')).toBe('before\n');
  });
});

describe('question tool', () => {
  it('returns the user-chosen option through the handler', async () => {
    const root = tempRoot();
    const seen: { question: string; options: string[] }[] = [];
    const { toolRegistry } = createWorkspaceTools(root, {
      onQuestion: async (q) => {
        seen.push({ question: q.question, options: q.options });
        return 'vitest';
      },
    });
    const out = await toolRegistry.question(
      questionCall({ header: 'Runner', question: 'Which test runner?', options: ['jest', 'vitest'] }),
    );
    expect(out).toBe('User answered: vitest');
    expect(seen).toEqual([{ question: 'Which test runner?', options: ['jest', 'vitest'] }]);
  });

  it('rejects fewer than 2 options', async () => {
    const root = tempRoot();
    const { toolRegistry } = createWorkspaceTools(root, { onQuestion: async () => 'x' });
    const out = await toolRegistry.question(questionCall({ question: 'q?', options: ['only one'] }));
    expect(out).toContain('provide 2-6 answer options');
  });

  it('answers without hanging when no handler is wired (headless)', async () => {
    const root = tempRoot();
    const { toolRegistry } = createWorkspaceTools(root);
    const out = await toolRegistry.question(
      questionCall({ question: 'q?', options: ['a', 'b'] }),
    );
    expect(out).toContain('no interactive question handler');
  });

  it('requires the question argument', async () => {
    const root = tempRoot();
    const { toolRegistry } = createWorkspaceTools(root);
    expect(await toolRegistry.question(questionCall({ options: ['a', 'b'] }))).toContain(
      'question parameter is required',
    );
  });
});
