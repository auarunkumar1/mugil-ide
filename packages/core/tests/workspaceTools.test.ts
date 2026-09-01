import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWorkspaceTools, WORKSPACE_TOOL_DEFINITIONS, extractCodeSkeleton } from '../src/modules/tools/workspaceTools.js';
import type { ToolCall } from '../src/types.js';

describe('Workspace Tools', () => {
  const root = path.resolve(__dirname, '..');
  const { tools, toolRegistry } = createWorkspaceTools(root);

  it('exposes the standard tool definitions', () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('read_skeleton');
    expect(names).toContain('list_files');
    expect(names).toContain('search_code');
    expect(names).toContain('codegraph');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('run_command');
    expect(names).toContain('todowrite');
    expect(names).toContain('todoread');
    expect(names).toContain('skill');
    expect(names).toContain('task');
    expect(names).toContain('webfetch');
    // websearch is env-gated (MUGIL_IDE_ENABLE_EXA) — absent when disabled.
    expect(names).not.toContain('websearch');
    expect(tools).not.toBe(WORKSPACE_TOOL_DEFINITIONS);
  });

  it('includes websearch (and lsp) when enabled — full identity list', () => {
    const { tools } = createWorkspaceTools(root, { websearchEnabled: true, lspEnabled: true });
    const names = tools.map((t) => t.name);
    expect(names).toContain('websearch');
    expect(names).toContain('webfetch');
    expect(names).toContain('lsp');
    expect(tools).toBe(WORKSPACE_TOOL_DEFINITIONS);
  });

  it('write_file and edit_file write and patch files surgically', async () => {
    const tmpFile = path.join(root, '.test_tmp_file.txt');
    const writeCall: ToolCall = {
      id: 'w1',
      name: 'write_file',
      arguments: JSON.stringify({ path: tmpFile, content: 'line one\nfoo target bar\nline three' }),
    };
    const writeRes = await toolRegistry.write_file(writeCall);
    expect(writeRes).toContain('Successfully wrote');

    const editCall: ToolCall = {
      id: 'e1',
      name: 'edit_file',
      arguments: JSON.stringify({ path: tmpFile, target: 'foo target bar', replacement: 'foo replaced bar' }),
    };
    const editRes = await toolRegistry.edit_file(editCall);
    expect(editRes).toContain('Successfully edited');

    const readCall: ToolCall = {
      id: 'r1',
      name: 'read_file',
      arguments: JSON.stringify({ path: tmpFile }),
    };
    const readRes = await toolRegistry.read_file(readCall);
    expect(readRes).toContain('foo replaced bar');

    // Clean up
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('read_file reads file with line numbers and supports ranges', async () => {
    const call: ToolCall = {
      id: 'c1',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'package.json', startLine: 1, endLine: 4 }),
    };
    const out = await toolRegistry.read_file(call);
    expect(out).toContain('1: {');
    expect(out).toContain('@mugil-ide/core');
  });

  it('list_files lists project files while skipping ignored directories', async () => {
    const call: ToolCall = {
      id: 'c2',
      name: 'list_files',
      arguments: JSON.stringify({ pattern: 'package.json' }),
    };
    const out = await toolRegistry.list_files(call);
    expect(out).toContain('package.json');
    expect(out).not.toContain('node_modules');
  });

  it('search_code finds code occurrences', async () => {
    const call: ToolCall = {
      id: 'c3',
      name: 'search_code',
      arguments: JSON.stringify({ query: 'ToolLoop', extension: 'ts' }),
    };
    const out = await toolRegistry.search_code(call);
    expect(out).toContain('tool-loop');
  });

  it('search_code truncates very long match lines (rtk compression)', async () => {
    const longFile = path.join(root, '.test_long_search.txt');
    fs.writeFileSync(longFile, `needle ${'x'.repeat(2000)} end`);
    const call: ToolCall = {
      id: 'c3b',
      name: 'search_code',
      arguments: JSON.stringify({ query: 'needle', extension: 'txt' }),
    };
    const out = await toolRegistry.search_code(call);
    expect(out).toContain('needle');
    expect(out.length).toBeLessThan(800);
    expect(out).toContain('+'); // the truncation marker from compressCommandOutput
    fs.unlinkSync(longFile);
  });

  it('codegraph analyzes symbols', async () => {
    const call: ToolCall = {
      id: 'c4',
      name: 'codegraph',
      arguments: JSON.stringify({ query: 'ToolLoop' }),
    };
    const out = await toolRegistry.codegraph(call);
    expect(out).toContain('CodeGraph Analysis');
    expect(out).toContain('ToolLoop');
  });

  it('run_command executes command and compresses output', async () => {
    const call: ToolCall = {
      id: 'c5',
      name: 'run_command',
      arguments: JSON.stringify({ command: 'node -e "console.log(12345)"' }),
    };
    const out = await toolRegistry.run_command(call);
    expect(out).toContain('12345');
  });

  it('rejects binary files on read', async () => {
    const binary = path.join(root, '.test_binary.bin');
    fs.writeFileSync(binary, Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const call: ToolCall = { id: 'b1', name: 'read_file', arguments: JSON.stringify({ path: binary }) };
    const out = await toolRegistry.read_file(call);
    expect(out).toContain('binary');
    fs.unlinkSync(binary);
  });

  it('truncates over-long lines in read output', async () => {
    const longFile = path.join(root, '.test_long.txt');
    fs.writeFileSync(longFile, `short line\n${'a'.repeat(2500)}\n`);
    const call: ToolCall = { id: 'b2', name: 'read_file', arguments: JSON.stringify({ path: longFile }) };
    const out = await toolRegistry.read_file(call);
    const longLine = out.split('\n')[1]!;
    expect(longLine.length).toBeLessThan(2100);
    expect(longLine.endsWith('…')).toBe(true);
    fs.unlinkSync(longFile);
  });

  it('rejects reads and writes outside the workspace root', async () => {
    const escapeRead: ToolCall = { id: 'b3', name: 'read_file', arguments: JSON.stringify({ path: path.join(root, '..', 'escape.txt') }) };
    const out = await toolRegistry.read_file(escapeRead);
    expect(out).toContain('outside the workspace');

    const escapeWrite: ToolCall = {
      id: 'b4',
      name: 'write_file',
      arguments: JSON.stringify({ path: path.join(root, '..', 'escape-write.txt'), content: 'nope' }),
    };
    const writeOut = await toolRegistry.write_file(escapeWrite);
    expect(writeOut).toContain('outside the workspace');
    expect(fs.existsSync(path.join(root, '..', 'escape-write.txt'))).toBe(false);
  });

  it('appends typecheck errors to write results when diagnostics are enabled', async () => {
    const fakeRunner = (): { output: string; ran: boolean } => ({
      output: 'src/a.ts(3,5): error TS2304: Cannot find name \'x\'.',
      ran: true,
    });
    const { toolRegistry: reg } = createWorkspaceTools(root, {
      diagnostics: true,
      runDiagnostics: fakeRunner,
    });
    const tmpFile = path.join(root, '.test_diag.txt');
    const writeCall: ToolCall = {
      id: 'd1',
      name: 'write_file',
      arguments: JSON.stringify({ path: tmpFile, content: 'let x = 1;' }),
    };
    const out = await reg.write_file(writeCall);
    expect(out).toContain('Successfully wrote');
    expect(out).toContain('[typecheck] errors found:');
    expect(out).toContain('error TS2304');
    fs.unlinkSync(tmpFile);
  });

  it('appends a clean-typecheck note when diagnostics find nothing', async () => {
    const { toolRegistry: reg } = createWorkspaceTools(root, {
      diagnostics: true,
      runDiagnostics: () => ({ output: '', ran: true }),
    });
    const tmpFile = path.join(root, '.test_diag2.txt');
    const writeCall: ToolCall = {
      id: 'd2',
      name: 'write_file',
      arguments: JSON.stringify({ path: tmpFile, content: 'ok' }),
    };
    const out = await reg.write_file(writeCall);
    expect(out).toContain('no type errors detected');
    fs.unlinkSync(tmpFile);
  });

  it('does not run diagnostics when disabled', async () => {
    const runner = jest.fn(() => ({ output: 'should not run', ran: true }));
    const { toolRegistry: reg } = createWorkspaceTools(root, {
      diagnostics: false,
      runDiagnostics: runner,
    });
    const tmpFile = path.join(root, '.test_diag3.txt');
    const writeCall: ToolCall = {
      id: 'd3',
      name: 'write_file',
      arguments: JSON.stringify({ path: tmpFile, content: 'ok' }),
    };
    const out = await reg.write_file(writeCall);
    expect(out).not.toContain('[typecheck]');
    expect(runner).not.toHaveBeenCalled();
    fs.unlinkSync(tmpFile);
  });

  it('todowrite replaces the list and todoread reads it back', async () => {
    const writeCall: ToolCall = {
      id: 't1',
      name: 'todowrite',
      arguments: JSON.stringify({
        todos: [
          { content: 'implement parser' },
          { content: 'add tests', status: 'in_progress' },
          { content: 'run typecheck', status: 'completed' },
        ],
      }),
    };
    const writeRes = await toolRegistry.todowrite(writeCall);
    expect(writeRes).toContain('3 items');

    const readCall: ToolCall = { id: 't2', name: 'todoread', arguments: '{}' };
    const readRes = await toolRegistry.todoread(readCall);
    expect(readRes).toContain('Todo list (3)');
    expect(readRes).toContain('implement parser');
    expect(readRes).toContain('(in_progress)');
    expect(readRes).toContain('(completed)');

    // Replacing with an empty array clears the list.
    const clearCall: ToolCall = { id: 't3', name: 'todowrite', arguments: JSON.stringify({ todos: [] }) };
    await toolRegistry.todowrite(clearCall);
    const after = await toolRegistry.todoread(readCall);
    expect(after).toContain('no todos yet');
  });

  it('read_skeleton extracts code outline and signatures', async () => {
    const tsCode = `
import { foo } from './foo';
export interface User {
  id: string;
  name: string;
}
export class AccountService {
  constructor(private db: any) {}
  async getAccount(id: string): Promise<User> {
    const user = await this.db.find(id);
    return user;
  }
}
`;
    const skeleton = extractCodeSkeleton(tsCode, 'service.ts');
    expect(skeleton).toContain('export interface User');
    expect(skeleton).toContain('export class AccountService');
    expect(skeleton).toContain('async getAccount');
    expect(skeleton).not.toContain('const user = await this.db.find(id);');
  });

  it('search_code groups matches by file', async () => {
    const searchCall: ToolCall = {
      id: 's1',
      name: 'search_code',
      arguments: JSON.stringify({ query: 'createWorkspaceTools' }),
    };
    const res = await toolRegistry.search_code(searchCall);
    expect(res).toContain('📁');
    expect(res).toContain('matches');
    expect(res).toContain('L');
  });
});
