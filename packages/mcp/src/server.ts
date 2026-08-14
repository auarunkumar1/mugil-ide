/**
 * Mugil IDE MCP Server
 * =================
 * Exposes the engine modules as Model Context Protocol tools so MCP clients
 * (Claude Desktop, Cursor, agent runtimes, ...) can use the token-efficient
 * pipeline directly:
 *
 *   - count_tokens             — token count via tiktoken (+ estimator fallback)
 *   - refine_prompt            — caveman + rtk + truncate cascade, with savings
 *   - strip_signatures         — prompt signature removal
 *   - strip_code_signatures    — AI-code signature/watermark removal
 *   - strip_watermarks         — AI provenance watermark removal (Layer A)
 *   - codegraph                — build a code knowledge graph (symbols/imports/calls)
 *   - codegraph_relevant       — find the code most relevant to a task (context injection)
 *   - compress_command_output  — RTK-style shell output compression
 *   - ask                      — full pipeline: strip → refine → cache → handoff
 *   - list_models              — the model ladder (tier, context window, costs)
 *
 * Tools are built on `@mugil-ide/core`'s credited modules; see ATTRIBUTIONS.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildCodeGraph,
  cavemanStrategy,
  compressCommandOutput,
  countTokens,
  createEngine,
  getTokenizer,
  loadConfig,
  queryCodeGraph,
  refinePrompt,
  rtkStrategy,
  stripCodeSignatures,
  stripSignatures,
  stripWatermarks,
  type Engine,
} from '@mugil-ide/core';

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

/** Builds the MCP server with the engine's tools registered. */
export function createMcpServer(engine: Engine = createEngine(loadConfig())): McpServer {
  const server = new McpServer({ name: 'mugil-ide', version: '1.0.0' });

  server.registerTool(
    'count_tokens',
    {
      title: 'Count tokens',
      description: 'Count the tokens in a text (tiktoken cl100k, with estimator fallback).',
      inputSchema: { text: z.string() },
    },
    async ({ text: input }) => {
      const tokenizer = getTokenizer();
      return text(
        JSON.stringify({ tokens: countTokens(input), tokenizer: tokenizer.name }, null, 2),
      );
    },
  );

  server.registerTool(
    'refine_prompt',
    {
      title: 'Refine prompt',
      description:
        'Compress a prompt with the token-efficiency cascade (caveman → rtk → truncate-to-budget) and report token savings.',
      inputSchema: {
        prompt: z.string(),
        budgetTokens: z.number().int().positive().optional(),
        strategies: z.array(z.enum(['caveman', 'rtk', 'truncate'])).optional(),
      },
    },
    async ({ prompt, budgetTokens, strategies }) => {
      const result = refinePrompt(prompt, { budgetTokens, strategies });
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'strip_signatures',
    {
      title: 'Strip prompt signatures',
      description:
        'Remove boilerplate signatures from a prompt: Anthropic/OpenAI identity preambles, Human:/<system> markers, gratitude closers, disclaimers.',
      inputSchema: {
        text: z.string(),
        providers: z.array(z.enum(['anthropic', 'openai', 'generic'])).optional(),
      },
    },
    async ({ text: input, providers }) => {
      const result = stripSignatures(input, { providers });
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'strip_code_signatures',
    {
      title: 'Strip AI code signatures',
      description:
        'Remove AI-generated attribution headers, AI-attribution comment lines and invisible watermark characters from code.',
      inputSchema: { code: z.string() },
    },
    async ({ code }) => {
      const result = stripCodeSignatures(code);
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'strip_watermarks',
    {
      title: 'Strip AI watermarks',
      description:
        'Remove AI provenance watermarks from generated text (Layer A, deterministic): invisible Unicode carriers (zero-width chars, bidi, tag chars), exotic spaces, and vendor attribution lines. Statistical token-sampling marks (Layer B) require a rewrite pass and are not removed here.',
      inputSchema: { text: z.string() },
    },
    async ({ text: input }) => {
      const result = stripWatermarks(input);
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'codegraph',
    {
      title: 'Build a code knowledge graph',
      description:
        'Scan a project directory and build a knowledge graph of symbols, import edges and same-file call edges (TS/JS, Python, Go, Rust). Returns the graph stats.',
      inputSchema: {
        root: z.string().optional(),
        ignoreDirs: z.array(z.string()).optional(),
        languages: z.array(z.enum(['typescript', 'python', 'go', 'rust'])).optional(),
      },
    },
    async ({ root, ignoreDirs, languages }) => {
      const graph = buildCodeGraph(root ?? process.cwd(), { ignoreDirs, languages });
      return text(JSON.stringify(graph.stats, null, 2));
    },
  );

  server.registerTool(
    'codegraph_relevant',
    {
      title: 'Find relevant code for a task',
      description:
        'Query a code knowledge graph for the symbols most relevant to a task description, with file/line and source snippets — the exact code the agent needs in one call.',
      inputSchema: {
        query: z.string(),
        root: z.string().optional(),
        top: z.number().int().positive().optional(),
      },
    },
    async ({ query, root, top }) => {
      const graph = buildCodeGraph(root ?? process.cwd());
      const results = queryCodeGraph(graph, query, { top });
      return text(JSON.stringify(results, null, 2));
    },
  );

  server.registerTool(
    'compress_command_output',
    {
      title: 'Compress command output',
      description:
        'RTK-style compression for shell output: collapse repeated lines, trim blank noise, truncate long lines.',
      inputSchema: {
        output: z.string(),
        maxLineLength: z.number().int().positive().optional(),
      },
    },
    async ({ output, maxLineLength }) => {
      const result = compressCommandOutput(output, { maxLineLength });
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'ask',
    {
      title: 'Ask the Mugil IDE engine',
      description:
        'Run the full token-efficient pipeline: signature strip → refinement → smart-cache lookup → model handoff (OpenRouter, mock offline). Returns the response plus usage, savings and cache metadata.',
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        noRefine: z.boolean().optional(),
        noCache: z.boolean().optional(),
        outputBudget: z.number().int().positive().optional(),
        ponytail: z.boolean().optional(),
      },
    },
    async ({ prompt, model, noRefine, noCache, outputBudget, ponytail }) => {
      const result = await engine.pipeline.ask(prompt, {
        preferredModel: model,
        noRefine,
        noCache,
        ponytail: outputBudget !== undefined ? { outputBudget } : ponytail === false ? false : true,
      });
      return text(JSON.stringify(result, null, 2));
    },
  );

  server.registerTool(
    'list_models',
    {
      title: 'List models',
      description: 'List the model ladder: tier, context window and cost per 1M tokens.',
      inputSchema: {},
    },
    async () => {
      return text(
        JSON.stringify(
          engine.config.models.map((m) => ({
            id: m.id,
            tier: m.tier,
            contextWindow: m.contextWindow,
            costPerMTokIn: m.costPerMTokIn,
            costPerMTokOut: m.costPerMTokOut,
          })),
          null,
          2,
        ),
      );
    },
  );

  // A couple of module-level tools are exposed individually too, so clients
  // can apply a single credited strategy without the full cascade.
  server.registerTool(
    'caveman',
    {
      title: 'Caveman compression',
      description: 'Apply only the caveman terse-phrasing strategy to a prompt.',
      inputSchema: { prompt: z.string() },
    },
    async ({ prompt }) => {
      return text(JSON.stringify(cavemanStrategy(prompt), null, 2));
    },
  );

  server.registerTool(
    'rtk',
    {
      title: 'RTK compression',
      description: 'Apply only the rtk reduced-token-kernel strategy to a prompt.',
      inputSchema: { prompt: z.string() },
    },
    async ({ prompt }) => {
      return text(JSON.stringify(rtkStrategy(prompt), null, 2));
    },
  );

  return server;
}
