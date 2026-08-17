import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MAX_UNDO_CONTENT_CHARS,
  captureFile,
  getRecordedEdits,
  pushEdit,
  redoLast,
  undoDepth,
  undoLast,
} from '../src/modules/undo.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { ToolCall } from '../src/types.js';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-undo-'));
}

const fileCall = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: 'c1',
  name,
  arguments: JSON.stringify(args),
});

describe('undo/redo store', () => {
  it('undo restores the previous content and redo re-applies the edit', () => {
    const root = tempRoot();
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'original');

    const before = captureFile(root, file);
    fs.writeFileSync(file, 'edited');
    pushEdit(root, { path: file, before, after: { content: 'edited', existed: true } });

    const undone = undoLast(root)!;
    expect(undone.action).toBe('restored');
    expect(undone.path).toBe('a.txt');
    expect(fs.readFileSync(file, 'utf-8')).toBe('original');

    const redone = redoLast(root)!;
    expect(redone.action).toBe('re-applied');
    expect(fs.readFileSync(file, 'utf-8')).toBe('edited');
  });

  it('undo removes a file the tool created, redo recreates it', () => {
    const root = tempRoot();
    const file = path.join(root, 'new.txt');

    const before = captureFile(root, file); // does not exist
    fs.writeFileSync(file, 'fresh');
    pushEdit(root, { path: file, before, after: { content: 'fresh', existed: true } });

    const undone = undoLast(root)!;
    expect(undone.action).toBe('removed');
    expect(fs.existsSync(file)).toBe(false);

    const redone = redoLast(root)!;
    expect(redone.action).toBe('re-applied');
    expect(fs.readFileSync(file, 'utf-8')).toBe('fresh');
  });

  it('undo of a move restores the source AND removes the destination; redo re-moves', () => {
    const root = tempRoot();
    const src = path.join(root, 'a.txt');
    const dst = path.join(root, 'b.txt');
    fs.writeFileSync(src, 'hello');

    // Record the move exactly as apply_patch does: source renamed, edit
    // recorded on the source with the destination in `movedTo`.
    fs.renameSync(src, dst);
    pushEdit(root, {
      path: src,
      before: { content: 'hello', existed: true },
      after: { content: '', existed: false },
      movedTo: dst,
    });

    const undone = undoLast(root)!;
    expect(undone.action).toBe('restored');
    expect(undone.message).toContain('moved back from b.txt');
    expect(fs.readFileSync(src, 'utf-8')).toBe('hello');
    expect(fs.existsSync(dst)).toBe(false); // no duplicate

    const redone = redoLast(root)!;
    expect(redone.action).toBe('re-applied');
    expect(redone.message).toContain('moved to b.txt');
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dst, 'utf-8')).toBe('hello'); // not lost
  });

  it('undoes multiple edits LIFO', () => {
    const root = tempRoot();
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'v0');

    const e1 = captureFile(root, file);
    fs.writeFileSync(file, 'v1');
    pushEdit(root, { path: file, before: e1, after: { content: 'v1', existed: true } });

    const e2 = captureFile(root, file);
    fs.writeFileSync(file, 'v2');
    pushEdit(root, { path: file, before: e2, after: { content: 'v2', existed: true } });

    undoLast(root);
    expect(fs.readFileSync(file, 'utf-8')).toBe('v1');
    undoLast(root);
    expect(fs.readFileSync(file, 'utf-8')).toBe('v0');
    // Both undone edits are redone in order.
    redoLast(root);
    expect(fs.readFileSync(file, 'utf-8')).toBe('v1');
    redoLast(root);
    expect(fs.readFileSync(file, 'utf-8')).toBe('v2');
  });

  it('a new edit clears the redo stack', () => {
    const root = tempRoot();
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'original');

    pushEdit(root, { path: file, before: { content: 'original', existed: true }, after: { content: 'edited', existed: true } });
    undoLast(root);
    // New edit after undo — redo must be empty (and the tool writes the file).
    pushEdit(root, { path: file, before: { content: 'original', existed: true }, after: { content: 'second', existed: true } });
    fs.writeFileSync(file, 'second', 'utf-8');
    expect(redoLast(root)).toBeNull();
    expect(fs.readFileSync(file, 'utf-8')).toBe('second');
  });

  it('returns null on empty stacks', () => {
    const root = tempRoot();
    expect(undoLast(root)).toBeNull();
    expect(redoLast(root)).toBeNull();
  });

  it('skips recording edits whose content exceeds the snapshot cap', () => {
    const root = tempRoot();
    const big = 'x'.repeat(MAX_UNDO_CONTENT_CHARS + 1);
    const note = pushEdit(root, {
      path: path.join(root, 'big.txt'),
      before: { content: '', existed: false },
      after: { content: big, existed: true },
    });
    expect(note).toContain('too large');
    expect(undoDepth(root)).toBe(0);
    expect(getRecordedEdits(root)).toHaveLength(0);
    expect(undoLast(root)).toBeNull();
  });

  it('records edits up to the snapshot cap', () => {
    const root = tempRoot();
    const big = 'x'.repeat(MAX_UNDO_CONTENT_CHARS);
    const note = pushEdit(root, {
      path: path.join(root, 'big.txt'),
      before: { content: '', existed: false },
      after: { content: big, existed: true },
    });
    expect(note).toBe('');
    expect(undoDepth(root)).toBe(1);
    expect(getRecordedEdits(root)).toHaveLength(1);
  });

  it('keeps per-root stacks independent', () => {
    const rootA = tempRoot();
    const rootB = tempRoot();
    const fileA = path.join(rootA, 'a.txt');
    fs.writeFileSync(fileA, 'A0');
    pushEdit(rootA, { path: fileA, before: { content: 'A0', existed: true }, after: { content: 'A1', existed: true } });

    expect(undoLast(rootB)).toBeNull();
    const undone = undoLast(rootA)!;
    expect(undone.path).toBe('a.txt');
    expect(fs.readFileSync(fileA, 'utf-8')).toBe('A0');
  });
});

describe('undo wiring into workspace tools', () => {
  it('write_file records an undoable edit', async () => {
    const root = tempRoot();
    const existing = path.join(root, 'keep.txt');
    fs.writeFileSync(existing, 'old');

    const { toolRegistry } = createWorkspaceTools(root);
    const rel = path.relative(root, existing);

    await toolRegistry.write_file(fileCall('write_file', { path: rel, content: 'new' }));
    expect(fs.readFileSync(existing, 'utf-8')).toBe('new');

    const undone = undoLast(root)!;
    expect(undone.path).toBe(rel);
    expect(fs.readFileSync(existing, 'utf-8')).toBe('old');
    redoLast(root);
    expect(fs.readFileSync(existing, 'utf-8')).toBe('new');
  });

  it('edit_file records an undoable edit', async () => {
    const root = tempRoot();
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, 'const x = 1;');

    const { toolRegistry } = createWorkspaceTools(root);
    await toolRegistry.edit_file(
      fileCall('edit_file', { path: 'a.ts', target: 'const x = 1;', replacement: 'const x = 2;' }),
    );
    expect(fs.readFileSync(file, 'utf-8')).toBe('const x = 2;');

    const undone = undoLast(root)!;
    expect(undone.action).toBe('restored');
    expect(fs.readFileSync(file, 'utf-8')).toBe('const x = 1;');
    redoLast(root);
    expect(fs.readFileSync(file, 'utf-8')).toBe('const x = 2;');
  });

  it('write_file of an oversized file still writes but is not undoable (notes the skip)', async () => {
    const root = tempRoot();
    const { toolRegistry } = createWorkspaceTools(root);
    const content = 'y'.repeat(MAX_UNDO_CONTENT_CHARS + 1);

    const result = await toolRegistry.write_file(fileCall('write_file', { path: 'huge.txt', content }));
    // The file was written, but the tool surfaces why it can't be undone.
    expect(fs.readFileSync(path.join(root, 'huge.txt'), 'utf-8')).toBe(content);
    expect(result).toContain('too large to snapshot for /undo');
    expect(undoLast(root)).toBeNull();
  });

  it('apply_patch move is undoable without leaving a duplicate or losing the file', async () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'old.ts'), 'export const x = 1;');

    const { toolRegistry } = createWorkspaceTools(root);
    const result = await toolRegistry.apply_patch(
      fileCall('apply_patch', {
        patch: '*** Update File: old.ts\n*** Move to: new.ts\n',
      }),
    );
    expect(result).toContain('Moved old.ts → new.ts');
    expect(fs.existsSync(path.join(root, 'old.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new.ts'))).toBe(true);

    // Undo: source restored, destination removed — exactly one copy remains.
    const undone = undoLast(root)!;
    expect(undone.message).toContain('moved back from new.ts');
    expect(fs.readFileSync(path.join(root, 'old.ts'), 'utf-8')).toBe('export const x = 1;');
    expect(fs.existsSync(path.join(root, 'new.ts'))).toBe(false);

    // Redo: move re-applied, destination recreated, source gone.
    const redone = redoLast(root)!;
    expect(redone.message).toContain('moved to new.ts');
    expect(fs.existsSync(path.join(root, 'old.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'new.ts'), 'utf-8')).toBe('export const x = 1;');
  });
});
