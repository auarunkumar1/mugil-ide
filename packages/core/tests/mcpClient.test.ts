import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  connectMcpServers,
  mcpResultToString,
  mcpToolName,
  parseMcpServerConfigs,
  type McpConnection,
  type McpServerConfig,
} from '../src/modules/mcp-client/index.js';
import {
  defaultPolicyForMode,
  resolveToolPermission,
} from '../src/modules/tools/permissions.js';
import type { ToolCall } from '../src/types.js';

describe('mcpToolName', () => {
  it('namespaces tools as mcp__server__tool', () => {
    expect(mcpToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
  });

  it('sanitizes non-word characters in server and tool names', () => {
    expect(mcpToolName('my server/1', 'do:thing')).toBe('mcp__my_server_1__do_thing');
  });
});

describe('parseMcpServerConfigs', () => {
  it('parses servers from the env JSON string', () => {
    const env = {
      MUGIL_IDE_MCP_SERVERS: JSON.stringify([
        { name: 'fs', command: 'npx', args: ['-y', 'server-filesystem'] },
      ]),
    };
    const servers = parseMcpServerConfigs(env as NodeJS.ProcessEnv);
    expect(servers).toEqual([
      { name: 'fs', command: 'npx', args: ['-y', 'server-filesystem'] },
    ]);
  });

  it('loads servers from the config file, env wins on name conflict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-mcp-config-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        { name: 'fs', command: 'npx', args: ['old'] },
        { name: 'web', url: 'https://example.com/mcp' },
      ]),
    );
    const env = {
      MUGIL_IDE_MCP_CONFIG: file,
      MUGIL_IDE_MCP_SERVERS: JSON.stringify([{ name: 'fs', command: 'npx', args: ['new'] }]),
    };
    const servers = parseMcpServerConfigs(env as NodeJS.ProcessEnv);
    expect(servers).toHaveLength(2);
    const byName = new Map(servers.map((s) => [s.name, s]));
    expect(byName.get('fs')?.args).toEqual(['new']);
    expect(byName.get('web')?.url).toBe('https://example.com/mcp');
  });

  it('ignores malformed config and invalid entries without throwing', () => {
    const env = {
      MUGIL_IDE_MCP_SERVERS: 'not-json',
      MUGIL_IDE_MCP_CONFIG: '/nonexistent/mcp.json',
    };
    expect(parseMcpServerConfigs(env as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('connectMcpServers', () => {
  const fakeConnector = (server: McpServerConfig): Promise<McpConnection> =>
    Promise.resolve({
      tools: [
        { name: 'read_file', description: 'Reads a file' },
        { name: 'search', description: 'Searches' },
      ],
      callTool: async (name, args) => `${server.name}::${name}::${JSON.stringify(args)}`,
      close: async () => {},
    });

  it('builds prefixed tool definitions and registry executors', async () => {
    const bundle = await connectMcpServers(
      [{ name: 'fs', command: 'npx', args: [] }],
      fakeConnector,
    );
    expect(bundle.errors).toEqual([]);
    expect(bundle.servers).toEqual(['fs']);
    expect(bundle.tools.map((t) => t.name)).toEqual(['mcp__fs__read_file', 'mcp__fs__search']);
    expect(bundle.tools[0]?.description).toBe('Reads a file');
    expect(bundle.tools[0]?.parameters).toHaveProperty('type', 'object');

    const result = await bundle.registry['mcp__fs__search']!({
      id: '1',
      name: 'mcp__fs__search',
      arguments: '{"q":"foo"}',
    });
    expect(result).toBe('fs::search::{"q":"foo"}');
    await bundle.close();
  });

  it('returns an error string for invalid JSON arguments', async () => {
    const bundle = await connectMcpServers([{ name: 'fs', command: 'npx' }], fakeConnector);
    const result = await bundle.registry['mcp__fs__read_file']!({
      id: '1',
      name: 'mcp__fs__read_file',
      arguments: 'not json',
    });
    expect(result).toContain('invalid JSON');
    await bundle.close();
  });

  it('collects connection failures as soft errors', async () => {
    const failing = async (): Promise<McpConnection> => {
      throw new Error('boom');
    };
    const bundle = await connectMcpServers([{ name: 'bad', url: 'https://x/mcp' }], failing);
    expect(bundle.tools).toEqual([]);
    expect(bundle.servers).toEqual([]);
    expect(bundle.errors[0]).toContain('bad');
    expect(bundle.errors[0]).toContain('boom');
    await bundle.close();
  });
});

describe('mcpResultToString', () => {
  it('flattens text content', () => {
    expect(
      mcpResultToString({
        content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }],
      }),
    ).toBe('hello\nworld');
  });

  it('marks images/audio/resources as placeholders', () => {
    expect(
      mcpResultToString({
        content: [{ type: 'image' }, { type: 'text', text: 'see above' }],
      }),
    ).toBe('[image]\nsee above');
  });

  it('prefixes error results and handles empty content', () => {
    expect(mcpResultToString({ isError: true, content: [{ type: 'text', text: 'nope' }] })).toBe(
      '[mcp error] nope',
    );
    expect(mcpResultToString({})).toBe('(empty MCP result)');
  });
});

describe('MCP permission prefix rules', () => {
  const call = (name: string): ToolCall => ({ id: '1', name, arguments: '{}' });

  it('denies mcp_ tools in plan mode without prompting', () => {
    expect(resolveToolPermission(defaultPolicyForMode('plan'), call('mcp__web__fetch'))).toBe(
      'deny',
    );
  });

  it('asks for mcp_ tools in act mode', () => {
    expect(resolveToolPermission(defaultPolicyForMode('act'), call('mcp__web__fetch'))).toBe(
      'ask',
    );
  });

  it('never affects non-prefixed built-in tools', () => {
    expect(resolveToolPermission(defaultPolicyForMode('act'), call('read_file'))).toBe('allow');
  });
});
