import * as path from 'node:path';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { McpConnection, McpServerConfig } from '../src/modules/mcp-client/index.js';
import type { ToolCall } from '../src/types.js';

const ROOT = path.resolve(__dirname, '..');

const webfetchCall = (args: Record<string, unknown>): ToolCall => ({
  id: 'w1',
  name: 'webfetch',
  arguments: JSON.stringify(args),
});

const websearchCall = (args: Record<string, unknown>): ToolCall => ({
  id: 's1',
  name: 'websearch',
  arguments: JSON.stringify(args),
});

/** Fake fetch returning a canned HTML page. */
function htmlFetch(body: string, contentType = 'text/html'): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } })) as typeof fetch;
}

/** Fake Exa MCP connector exposing web_search_exa. */
function exaConnector(result: string): (server: McpServerConfig) => Promise<McpConnection> {
  return async () => ({
    tools: [{ name: 'web_search_exa', description: 'Search the web' }],
    callTool: async (name, args) => `${result}::${name}::${JSON.stringify(args)}`,
    close: async () => {},
  });
}

describe('webfetch tool', () => {
  it('fetches a page and strips HTML to text', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      fetchFn: htmlFetch(
        '<html><head><style>.x{color:red}</style><script>alert(1)</script></head>' +
          '<body><h1>Hello</h1><p>World &amp; more</p></body></html>',
      ),
    });
    const out = await toolRegistry.webfetch(webfetchCall({ url: 'https://example.com/docs' }));
    expect(out).toContain('Hello');
    expect(out).toContain('World & more');
    expect(out).not.toContain('<h1>');
    expect(out).not.toContain('alert');
  });

  it('rejects non-http(s) URLs', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT, { fetchFn: htmlFetch('x') });
    expect(await toolRegistry.webfetch(webfetchCall({ url: 'file:///etc/passwd' }))).toContain(
      'only http:// and https://',
    );
    expect(await toolRegistry.webfetch(webfetchCall({ url: 'ftp://host/file' }))).toContain(
      'only http:// and https://',
    );
  });

  it('truncates long pages to maxChars', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      fetchFn: htmlFetch('<p>' + 'word '.repeat(5000) + '</p>'),
    });
    // maxChars below 1000 is clamped up to keep output usable.
    const out = await toolRegistry.webfetch(webfetchCall({ url: 'https://example.com', maxChars: 500 }));
    expect(out).toContain('truncated at 1000 chars');
    expect(out.length).toBeLessThan(800);
  });

  it('reports non-text content and HTTP errors', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      fetchFn: htmlFetch('PNG bytes', 'image/png'),
    });
    expect(await toolRegistry.webfetch(webfetchCall({ url: 'https://example.com/a.png' }))).toContain(
      'non-text content',
    );

    const errorFetch = (async () =>
      new Response('Not Found', { status: 404, statusText: 'Not Found' })) as typeof fetch;
    const tools2 = createWorkspaceTools(ROOT, { fetchFn: errorFetch });
    expect(await tools2.toolRegistry.webfetch(webfetchCall({ url: 'https://example.com/missing' }))).toContain(
      'HTTP 404',
    );
  });

  it('returns a readable error when the fetch fails', async () => {
    const failing = (async () => {
      throw new Error('ENOTFOUND example.com');
    }) as typeof fetch;
    const { toolRegistry } = createWorkspaceTools(ROOT, { fetchFn: failing });
    expect(await toolRegistry.webfetch(webfetchCall({ url: 'https://example.com' }))).toContain(
      'ENOTFOUND example.com',
    );
  });

  it('requires a url argument', async () => {
    const { toolRegistry } = createWorkspaceTools(ROOT, { fetchFn: htmlFetch('x') });
    expect(await toolRegistry.webfetch(webfetchCall({}))).toContain('url parameter is required');
  });
});

describe('websearch tool', () => {
  it('is disabled by default and explains how to enable it', async () => {
    const { toolRegistry, tools } = createWorkspaceTools(ROOT);
    expect(tools.map((t) => t.name)).not.toContain('websearch');
    const out = await toolRegistry.websearch(websearchCall({ query: 'foo' }));
    expect(out).toContain('disabled');
    expect(out).toContain('MUGIL_IDE_ENABLE_EXA=1');
  });

  it('queries the Exa MCP server when enabled', async () => {
    const connector = exaConnector('search results for');
    const { toolRegistry, tools } = createWorkspaceTools(ROOT, {
      websearchEnabled: true,
      websearchConnect: connector,
    });
    expect(tools.map((t) => t.name)).toContain('websearch');

    const out = await toolRegistry.websearch(websearchCall({ query: 'node fetch', numResults: 3 }));
    expect(out).toContain('search results for');
    expect(out).toContain('"query":"node fetch"');
    expect(out).toContain('"numResults":3');
  });

  it('truncates very long search output', async () => {
    const connector = exaConnector('x'.repeat(20_000));
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      websearchEnabled: true,
      websearchConnect: connector,
    });
    const out = await toolRegistry.websearch(websearchCall({ query: 'foo' }));
    expect(out.length).toBeLessThan(8500);
    expect(out).toContain('truncated at 8000 chars');
  });

  it('reports when the Exa server is unavailable', async () => {
    const failing = async (): Promise<McpConnection> => {
      throw new Error('connection refused');
    };
    const { toolRegistry } = createWorkspaceTools(ROOT, {
      websearchEnabled: true,
      websearchConnect: failing,
    });
    const out = await toolRegistry.websearch(websearchCall({ query: 'foo' }));
    expect(out).toContain('websearch unavailable');
  });
});
