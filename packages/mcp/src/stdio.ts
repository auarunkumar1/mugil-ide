#!/usr/bin/env node
/**
 * Mugil IDE MCP server over stdio. Point an MCP client at this executable, e.g.
 * in Claude Desktop:
 *
 *   "mcpServers": {
 *     "mugil-ide": { "command": "mugil-ide-mcp" }
 *   }
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
