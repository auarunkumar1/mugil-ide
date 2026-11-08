/**
 * Lazy MCP Schema Gateway
 * =======================
 * Eliminates static prompt bloat (2,000–5,000 tokens per turn) caused by dumping
 * every external MCP tool's JSON schema into every turn.
 *
 * Exposes two lightweight meta-tools:
 *   - `list_mcp_tools`: discovers connected servers and tool signatures on-demand
 *   - `call_mcp`: executes any tool dynamically across connected servers
 */

import type { ToolCall, ToolDefinition } from '../../types.js';
import type { ToolRegistry } from '../tool-loop/index.js';
import {
  type McpConnection,
  type McpConnector,
  type McpServerConfig,
  type McpToolsBundle,
  connectMcpServers,
} from './index.js';

export const LAZY_MCP_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_mcp_tools',
    description:
      'List available tools on connected external MCP servers with concise summaries. Optionally specify a server or tool name to inspect full input schema on demand. Saves 2,000-5,000 tokens vs static schema dumping.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional server name to filter tools.' },
        tool: { type: 'string', description: 'Optional tool name to retrieve full parameter schema.' },
      },
    },
  },
  {
    name: 'call_mcp',
    description:
      'Execute a tool on a connected MCP server dynamically. Pass server name, tool name, and arguments object.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Name of the MCP server.' },
        tool: { type: 'string', description: 'Name of the tool on the server.' },
        arguments: { type: 'object', description: 'Tool arguments object.' },
      },
      required: ['server', 'tool'],
    },
  },
];

export interface LazyMcpOptions {
  lazy?: boolean;
}

export async function createLazyMcpGateway(
  configs: McpServerConfig[],
  connect?: McpConnector,
  options: LazyMcpOptions = { lazy: true },
): Promise<McpToolsBundle> {
  if (options.lazy === false) {
    return connectMcpServers(configs, connect);
  }

  const errors: string[] = [];
  const servers: string[] = [];
  const closers: (() => Promise<void>)[] = [];
  const serverMap = new Map<string, McpConnection>();

  for (const cfg of configs) {
    try {
      if (!connect) {
        // Fallback eager connector if none provided
        const bundle = await connectMcpServers([cfg]);
        return bundle;
      }
      const conn = await connect(cfg);
      closers.push(() => conn.close());
      serverMap.set(cfg.name, conn);
      servers.push(cfg.name);
    } catch (err) {
      errors.push(`MCP server "${cfg.name}" unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const registry: ToolRegistry = {
    list_mcp_tools: async (call: ToolCall): Promise<string> => {
      let args: { server?: string; tool?: string } = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        // use defaults
      }

      if (serverMap.size === 0) {
        return 'No MCP servers currently connected.';
      }

      const out: string[] = [];

      for (const [srvName, conn] of serverMap.entries()) {
        if (args.server && args.server !== srvName) continue;

        out.push(`Server: ${srvName} (${conn.tools.length} tools)`);
        for (const t of conn.tools) {
          if (args.tool && args.tool !== t.name) continue;

          if (args.tool === t.name) {
            // Detailed schema
            out.push(`  - ${t.name}: ${t.description || 'No description'}`);
            out.push(`    Parameters: ${JSON.stringify(t.inputSchema || {}, null, 2)}`);
          } else {
            // 1-line summary
            out.push(`  - ${t.name}: ${t.description || 'No description'}`);
          }
        }
      }

      return out.join('\n') || 'No matching tools found.';
    },

    call_mcp: async (call: ToolCall): Promise<string> => {
      let args: { server?: string; tool?: string; arguments?: Record<string, unknown> } = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        return 'Error: invalid JSON arguments for call_mcp.';
      }

      if (!args.server || !args.tool) {
        return 'Error: server and tool parameters are required for call_mcp.';
      }

      const conn = serverMap.get(args.server);
      if (!conn) {
        return `Error: MCP server "${args.server}" not found. Available servers: ${[...serverMap.keys()].join(', ') || 'none'}`;
      }

      try {
        return await conn.callTool(args.tool, args.arguments ?? {});
      } catch (err) {
        return `Error: MCP tool "${args.server}/${args.tool}" failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  return {
    tools: LAZY_MCP_TOOL_DEFINITIONS,
    registry,
    errors,
    servers,
    close: async () => {
      for (const close of closers) {
        try {
          await close();
        } catch {
          // ignore teardown errors
        }
      }
    },
  };
}
