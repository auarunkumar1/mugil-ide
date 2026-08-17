/**
 * MCP Client — consume remote/local MCP servers as agent tools
 * ============================================================
 * Lets the agent loop use tools from configured MCP servers (OpenCode-style
 * MCP consumption), complementing the `@mugil-ide/mcp` server this project
 * already ships. Two transport kinds are supported per server:
 *
 *   - stdio (local):  { "name": "fs",  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
 *   - HTTP (remote):  { "name": "web", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
 *
 * Servers are configured via `MUGIL_IDE_MCP_SERVERS` (JSON string) and/or
 * `MUGIL_IDE_MCP_CONFIG` (JSON file; the env value wins on name conflicts).
 * Each server's tools are exposed as `mcp__<server>__<tool>` so names never
 * collide with the built-in workspace tools, and every call goes through the
 * SDK client. Connection failures are soft: the server is skipped and the
 * error is collected into `bundle.errors` for the caller to surface.
 *
 * Credit: Model Context Protocol (`@modelcontextprotocol/sdk`) —
 * https://modelcontextprotocol.io. See ATTRIBUTIONS.md for the full list.
 */
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolCall, ToolDefinition } from '../../types.js';
import type { ToolRegistry } from '../tool-loop/index.js';

export interface McpServerConfig {
  /** Unique name used in tool prefixes (`mcp__<name>__<tool>`). */
  name: string;
  /** stdio transport: the command to spawn. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** HTTP transport: a streamable-HTTP MCP endpoint URL. */
  url?: string;
  headers?: Record<string, string>;
}

export interface McpToolsBundle {
  /** Prefixed tool definitions to append to the agent's tool set. */
  tools: ToolDefinition[];
  /** Executors for every prefixed tool. */
  registry: ToolRegistry;
  /** Human-readable connection failures (empty when all servers connected). */
  errors: string[];
  /** Names of servers that connected successfully. */
  servers: string[];
  /** Closes all client connections (kills stdio children). */
  close: () => Promise<void>;
}

export interface McpConnection {
  tools: { name: string; description?: string; inputSchema?: unknown }[];
  callTool: (name: string, args: unknown) => Promise<string>;
  close: () => Promise<void>;
}

export type McpConnector = (server: McpServerConfig) => Promise<McpConnection>;

/** Namespaced tool name: `mcp__server__tool` (non-word chars → `_`). */
export function mcpToolName(server: string, tool: string): string {
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp__${safe(server)}__${safe(tool)}`;
}

/** Reads MCP server configs: file first, env JSON wins on name conflicts. */
export function parseMcpServerConfigs(env: NodeJS.ProcessEnv = process.env): McpServerConfig[] {
  const byName = new Map<string, McpServerConfig>();
  const ingest = (raw: string): void => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (isValidServerConfig(entry)) byName.set(entry.name, entry);
      }
    } catch {
      // malformed config is ignored (never crash the engine)
    }
  };
  if (env.MUGIL_IDE_MCP_CONFIG) {
    try {
      ingest(fs.readFileSync(env.MUGIL_IDE_MCP_CONFIG, 'utf-8'));
    } catch {
      // unreadable config file is ignored
    }
  }
  if (env.MUGIL_IDE_MCP_SERVERS) ingest(env.MUGIL_IDE_MCP_SERVERS);
  return [...byName.values()];
}

/**
 * Connects every configured server and builds prefixed tool definitions +
 * registry executors. A failed server is skipped and reported in `errors`.
 * Pass `connect` (tests) to substitute a fake connector.
 */
export async function connectMcpServers(
  configs: McpServerConfig[],
  connect: McpConnector = connectOneMcpServer,
): Promise<McpToolsBundle> {
  const tools: ToolDefinition[] = [];
  const registry: ToolRegistry = {};
  const errors: string[] = [];
  const servers: string[] = [];
  const closers: (() => Promise<void>)[] = [];

  for (const server of configs) {
    try {
      const connection = await connect(server);
      closers.push(() => connection.close());
      for (const tool of connection.tools) {
        const name = mcpToolName(server.name, tool.name);
        tools.push({
          name,
          description: tool.description ?? '',
          parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        });
        registry[name] = async (call: ToolCall): Promise<string> => {
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            return 'Error: invalid JSON arguments for MCP tool.';
          }
          try {
            return await connection.callTool(tool.name, args);
          } catch (err) {
            return `Error: MCP tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        };
      }
      servers.push(server.name);
    } catch (err) {
      errors.push(
        `MCP server "${server.name}" unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    tools,
    registry,
    errors,
    servers,
    close: async () => {
      for (const close of closers) {
        try {
          await close();
        } catch {
          // best-effort teardown
        }
      }
    },
  };
}

/** Flattens an SDK CallToolResult into a single string for the model. */
export function mcpResultToString(result: {
  isError?: boolean;
  content?: { type?: string; text?: string }[];
}): string {
  const parts = (result.content ?? [])
    .map((c) => {
      if (c.type === 'image') return '[image]';
      if (c.type === 'audio') return '[audio]';
      if (c.type === 'resource') return '[resource]';
      return c.text ?? '';
    })
    .filter((p) => p.length > 0);
  const text = parts.join('\n') || '(empty MCP result)';
  return result.isError ? `[mcp error] ${text}` : text;
}

/** Default connector: SDK Client over stdio (command) or streamable HTTP (url). */
async function connectOneMcpServer(server: McpServerConfig): Promise<McpConnection> {
  const client = new Client({ name: 'mugil-ide', version: '0.1.0' });
  const transport = server.url
    ? new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: server.headers ? { headers: server.headers } : undefined,
      })
    : new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        env: server.env,
      });
  await client.connect(transport);
  const listed = await client.listTools();
  return {
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args as Record<string, unknown> | undefined });
      return mcpResultToString(result as { isError?: boolean; content?: { type?: string; text?: string }[] });
    },
    close: async () => {
      await client.close();
    },
  };
}

function isValidServerConfig(s: unknown): s is McpServerConfig {
  if (!s || typeof s !== 'object') return false;
  const c = s as McpServerConfig;
  return (
    typeof c.name === 'string' &&
    c.name.trim().length > 0 &&
    ((typeof c.command === 'string' && c.command.trim().length > 0) ||
      (typeof c.url === 'string' && (c.url.startsWith('http://') || c.url.startsWith('https://'))))
  );
}
