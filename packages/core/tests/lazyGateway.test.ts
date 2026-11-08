import { createLazyMcpGateway } from '../src/modules/mcp-client/lazyGateway.js';
import type { McpConnection, McpServerConfig } from '../src/modules/mcp-client/index.js';

describe('Lazy MCP Gateway', () => {
  const fakeServer: McpServerConfig = {
    name: 'filesystem',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem'],
  };

  const fakeConnection: McpConnection = {
    tools: [
      {
        name: 'read_text',
        description: 'Read a file from disk',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'write_text',
        description: 'Write a file to disk',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, text: { type: 'string' } },
        },
      },
    ],
    callTool: async (name: string, args: any) => {
      if (name === 'read_text') return `Content of ${args.path}: hello world`;
      return `Wrote to ${args.path}`;
    },
    close: async () => {},
  };

  const fakeConnector = async () => fakeConnection;

  it('exposes only 2 compact tools instead of dumping all server schemas', async () => {
    const bundle = await createLazyMcpGateway([fakeServer], fakeConnector, { lazy: true });
    expect(bundle.tools).toHaveLength(2);
    expect(bundle.tools.map((t) => t.name)).toEqual(['list_mcp_tools', 'call_mcp']);
    expect(bundle.servers).toEqual(['filesystem']);
  });

  it('keeps every connectable server when no connector is injected', async () => {
    // Regression: the eager fallback used to `return` inside the config loop,
    // so only the first server of a multi-server config ever appeared.
    const many: McpServerConfig[] = [
      { name: 'one', command: 'a' },
      { name: 'two', command: 'b' },
      { name: 'three', command: 'c' },
    ];
    const seen: string[] = [];
    const bundle = await createLazyMcpGateway(many, async (cfg) => {
      seen.push(cfg.name);
      return fakeConnection;
    });
    expect(seen).toEqual(['one', 'two', 'three']);
    expect(bundle.servers).toEqual(['one', 'two', 'three']);
    expect(bundle.registry.call_mcp).toBeDefined();
  });
  it('lists available tools across servers on demand', async () => {
    const bundle = await createLazyMcpGateway([fakeServer], fakeConnector, { lazy: true });
    const listRes = await bundle.registry.list_mcp_tools({
      id: '1',
      name: 'list_mcp_tools',
      arguments: '{}',
    });

    expect(listRes).toContain('Server: filesystem (2 tools)');
    expect(listRes).toContain('read_text: Read a file from disk');
    expect(listRes).toContain('write_text: Write a file to disk');

    // Inspect detailed schema
    const detailRes = await bundle.registry.list_mcp_tools({
      id: '2',
      name: 'list_mcp_tools',
      arguments: JSON.stringify({ tool: 'read_text' }),
    });
    expect(detailRes).toContain('Parameters:');
    expect(detailRes).toContain('"path"');
  });

  it('calls MCP tool dynamically via call_mcp', async () => {
    const bundle = await createLazyMcpGateway([fakeServer], fakeConnector, { lazy: true });
    const callRes = await bundle.registry.call_mcp({
      id: '3',
      name: 'call_mcp',
      arguments: JSON.stringify({
        server: 'filesystem',
        tool: 'read_text',
        arguments: { path: '/tmp/test.txt' },
      }),
    });

    expect(callRes).toBe('Content of /tmp/test.txt: hello world');
  });

  it('returns clean error message when calling nonexistent server', async () => {
    const bundle = await createLazyMcpGateway([fakeServer], fakeConnector, { lazy: true });
    const callRes = await bundle.registry.call_mcp({
      id: '4',
      name: 'call_mcp',
      arguments: JSON.stringify({
        server: 'ghost_server',
        tool: 'do_something',
      }),
    });

    expect(callRes).toContain('MCP server "ghost_server" not found');
  });
});
