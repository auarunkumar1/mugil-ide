import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import {
  FramedStreamReader,
  formatLspLocations,
  hoverText,
  languageIdFor,
  type LspClient,
} from '../src/modules/lsp/index.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { ToolCall } from '../src/types.js';

const ROOT = path.resolve(__dirname, '..');
const lspCall = (args: Record<string, unknown>): ToolCall => ({
  id: 'l1',
  name: 'lsp',
  arguments: JSON.stringify(args),
});

/** Fake client recording the exact positions it received. */
function fakeClient(output: string): { client: LspClient; calls: { op: string; line: number; character: number }[] } {
  const calls: { op: string; line: number; character: number }[] = [];
  return {
    calls,
    client: {
      goToDefinition: async (_f, line, character) => {
        calls.push({ op: 'goToDefinition', line, character });
        return output;
      },
      findReferences: async (_f, line, character) => {
        calls.push({ op: 'findReferences', line, character });
        return output;
      },
      hover: async (_f, line, character) => {
        calls.push({ op: 'hover', line, character });
        return output;
      },
      close: async () => {},
    },
  };
}

describe('formatLspLocations', () => {
  const uri = (rel: string): string => pathToFileURL(path.join(ROOT, rel)).href;

  it('formats Location arrays as relpath:line:col (1-indexed)', () => {
    const out = formatLspLocations(ROOT, [
      { uri: uri('src/a.ts'), range: { start: { line: 3, character: 7 } } },
      { uri: uri('src/b.ts'), range: { start: { line: 0, character: 0 } } },
    ]);
    expect(out).toBe('src/a.ts:4:8\nsrc/b.ts:1:1');
  });

  it('handles a single Location, LocationLink, and null', () => {
    expect(formatLspLocations(ROOT, { uri: uri('a.ts'), range: { start: { line: 1, character: 2 } } })).toBe('a.ts:2:3');
    expect(
      formatLspLocations(ROOT, [
        { targetUri: uri('a.ts'), targetRange: { start: { line: 5, character: 0 } } },
      ]),
    ).toBe('a.ts:6:1');
    expect(formatLspLocations(ROOT, null)).toBe('(no results)');
    expect(formatLspLocations(ROOT, [])).toBe('(no results)');
  });

  it('caps at 50 locations', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      uri: uri(`a${i}.ts`),
      range: { start: { line: 0, character: 0 } },
    }));
    const out = formatLspLocations(ROOT, many);
    expect(out.split('\n')).toHaveLength(50);
  });
});

describe('hoverText', () => {
  it('extracts plain strings, MarkupContent, and MarkedString arrays', () => {
    expect(hoverText('hello')).toBe('hello');
    expect(hoverText({ kind: 'markdown', value: '**bold**' })).toBe('**bold**');
    expect(hoverText([{ language: 'ts', value: 'const x' }, 'doc text'])).toBe('const x\ndoc text');
    expect(hoverText(null)).toBe('(no hover content)');
    expect(hoverText({})).toBe('(no hover content)');
  });
});

describe('languageIdFor', () => {
  it('maps extensions to LSP language ids', () => {
    expect(languageIdFor('a.ts')).toBe('typescript');
    expect(languageIdFor('a.tsx')).toBe('typescriptreact');
    expect(languageIdFor('a.js')).toBe('javascript');
    expect(languageIdFor('a.json')).toBe('json');
    expect(languageIdFor('a.weird')).toBe('typescript');
  });
});

describe('FramedStreamReader', () => {
  it('parses frames split across chunks and multiple frames per chunk', () => {
    const messages: Record<string, unknown>[] = [];
    const stream = new EventEmitter();
    new FramedStreamReader(stream as unknown as NodeJS.ReadableStream, (m) => messages.push(m));
    const frame = (id: number): string => {
      const body = JSON.stringify({ jsonrpc: '2.0', id, result: id * 10 });
      return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
    };
    // Split the first frame mid-body; append two frames in one chunk.
    const full = frame(1) + frame(2);
    const cut = Math.floor(full.length / 2);
    stream.emit('data', Buffer.from(full.slice(0, cut)));
    stream.emit('data', Buffer.from(full.slice(cut)));
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 1, result: 10 },
      { jsonrpc: '2.0', id: 2, result: 20 },
    ]);
  });
});

describe('lsp tool', () => {
  it('is only offered when enabled', () => {
    const disabled = createWorkspaceTools(ROOT);
    expect(disabled.tools.map((t) => t.name)).not.toContain('lsp');
    const enabled = createWorkspaceTools(ROOT, { lspEnabled: true });
    expect(enabled.tools.map((t) => t.name)).toContain('lsp');
  });

  it('runs operations through the client with 1-indexed positions converted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-lsp-'));
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const fake = fakeClient('a.ts:1:1\nb.ts:2:5');
    const { toolRegistry } = createWorkspaceTools(root, { lspEnabled: true, lspConnect: async () => fake.client });

    const out = await toolRegistry.lsp(lspCall({ operation: 'goToDefinition', path: 'a.ts', line: 3, character: 5 }));
    expect(out).toContain('a.ts:1:1');
    expect(fake.calls).toEqual([{ op: 'goToDefinition', line: 2, character: 4 }]);
  });

  it('supports findReferences and hover', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-lsp-'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'x\n');
    const fake = fakeClient('hover: string');
    const { toolRegistry } = createWorkspaceTools(root, { lspEnabled: true, lspConnect: async () => fake.client });

    await toolRegistry.lsp(lspCall({ operation: 'findReferences', path: 'a.ts' }));
    await toolRegistry.lsp(lspCall({ operation: 'hover', path: 'a.ts', line: 2 }));
    expect(fake.calls.map((c) => c.op)).toEqual(['findReferences', 'hover']);
    expect(fake.calls[1]!.line).toBe(1);
  });

  it('validates input and reports disabled / failure states', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-lsp-'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'x\n');
    const { toolRegistry } = createWorkspaceTools(root); // disabled

    expect(await toolRegistry.lsp(lspCall({ operation: 'nope', path: 'a.ts' }))).toContain(
      'operation must be one of',
    );
    expect(await toolRegistry.lsp(lspCall({ operation: 'hover', path: 'a.ts' }))).toContain(
      'MUGIL_IDE_ENABLE_LSP=1',
    );
    expect(await toolRegistry.lsp(lspCall({ operation: 'hover' }))).toContain('path parameter is required');

    // File-not-found requires an enabled toolset (the disabled gate fires first).
    const enabledTools = createWorkspaceTools(root, { lspEnabled: true, lspConnect: async () => fakeClient('x').client });
    expect(await enabledTools.toolRegistry.lsp(lspCall({ operation: 'hover', path: 'missing.ts' }))).toContain(
      'file not found',
    );

    const failing: LspClient = {
      goToDefinition: async () => {
        throw new Error('connection refused');
      },
      findReferences: async () => 'x',
      hover: async () => 'x',
      close: async () => {},
    };
    const tools2 = createWorkspaceTools(root, { lspEnabled: true, lspConnect: async () => failing });
    expect(
      await tools2.toolRegistry.lsp(lspCall({ operation: 'goToDefinition', path: 'a.ts' })),
    ).toContain('connection refused');
  });
});
