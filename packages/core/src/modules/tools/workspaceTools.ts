/**
 * Built-in Workspace Tools
 * ========================
 * Provides standard IDE tools (read_file, list_files, search_code, codegraph,
 * write_file, edit_file, apply_patch, run_command, todowrite, todoread, skill,
 * webfetch, websearch, question, task) for the bounded agentic ToolLoop harness.
 *
 * Tool descriptions are written to teach the model how to use them (absolute
 * paths, batched parallel reads, output caps), following the established
 * coding-agent practice from OpenCode / Claude Code. Tool execution is
 * hardened: reads reject binary files and over-long lines, and every path is
 * contained inside the workspace root.
 *
 * Credit: tool semantics + usage-first descriptions inspired by OpenCode —
 * https://github.com/sst/opencode. See ATTRIBUTIONS.md for the full list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolCall, ToolDefinition } from '../../types.js';
import { ToolLoop, parseToolArguments, type ToolRegistry } from '../tool-loop/index.js';
import type { HandoffManager } from '../handoff/index.js';
import { buildCodeGraph, queryCodeGraph } from '../codegraph/index.js';
import { cavemanStrategy } from '../caveman/index.js';
import { compressCommandOutput } from '../rtk/index.js';
import { discoverSkills, loadSkill } from '../skills/index.js';
import { createPermissionCheck, defaultPolicyForMode, type PermissionCheck } from './permissions.js';
import { runDiagnostics, type DiagnosticsResult } from './diagnostics.js';
import { captureFile, pushEdit } from '../undo.js';
import { connectMcpServers, type McpConnector, type McpServerConfig, type McpToolsBundle } from '../mcp-client/index.js';
import { getLspClient, type LspClient } from '../lsp/index.js';

export const WORKSPACE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read a file from the workspace with optional 1-indexed line ranges. Paths may be relative to the workspace root; files must stay inside the workspace. Binary files are rejected. Lines longer than 2000 characters are truncated with "…". Batch independent reads in a single response — call this tool multiple times in parallel to avoid round-trips.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the workspace root or absolute inside the workspace.' },
        startLine: { type: 'number', description: 'Optional 1-indexed start line (inclusive).' },
        endLine: { type: 'number', description: 'Optional 1-indexed end line (inclusive).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_skeleton',
    description:
      'Extract the AST skeleton/outline of a code file (interfaces, types, classes, methods, functions, exported symbols) omitting internal function bodies. Provides 70-80% token reduction when exploring large files. Paths may be relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the workspace root or absolute inside the workspace.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files and directories in the workspace (ignores node_modules, .git, dist, .cache, build, coverage). Optionally filter by a file extension (e.g. ".tsx") or a substring (e.g. "app"). Results are capped at 80 entries — use a pattern to narrow a large tree.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Directory path relative to the workspace root (defaults to the root itself).' },
        pattern: { type: 'string', description: 'Optional file extension or substring filter (e.g. ".tsx" or "app").' },
      },
    },
  },
  {
    name: 'search_code',
    description:
      'Search for text or a regular expression across workspace files. Returns up to 40 matches as "file:line: content". Use it to find where a symbol is defined, referenced, or where an error message originates. Prefer this over reading files blindly.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern to search for.' },
        extension: { type: 'string', description: 'Optional file extension filter (e.g. "ts", "tsx", "py").' },
      },
      required: ['query'],
    },
  },
  {
    name: 'codegraph',
    description:
      'Query the codebase knowledge graph for the symbols, callers, imports, and definitions relevant to a function, class, or task. Returns the top 10 ranked symbols with signatures. Use it to understand how code connects before editing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task, function, or symbol name to look up in the code graph.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or overwrite an existing one in the workspace with full content. Parent directories are created automatically. Paths must stay inside the workspace. This tool may require user approval — expect a "Permission denied" result if it is not granted.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the workspace root or absolute inside the workspace.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Surgically replace a unique target text block in a file with replacement text. The target must match exactly (including indentation) and appear exactly once — otherwise the edit is rejected. Prefer small, precise edits over rewriting whole files. This tool may require user approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, relative to the workspace root or absolute inside the workspace.' },
        target: { type: 'string', description: 'Exact string to be replaced in the file.' },
        replacement: { type: 'string', description: 'Replacement content.' },
      },
      required: ['path', 'target', 'replacement'],
    },
  },
  {
    name: 'apply_patch',
    description:
      'Apply a patch that edits multiple files in a single call (OpenCode-style). Directives are separated by *** markers:\n' +
      '  *** Add File: src/new.ts\n  <file content>\n' +
      '  *** Update File: src/existing.ts\n  @@\n  -line to remove\n  +line to add\n   unchanged context\n' +
      '  *** Delete File: src/old.ts\n  *** Update File: src/a.ts\n  *** Move to: src/b.ts\n' +
      'Update hunks use - / + / (space) prefixes; each hunk needs at least one context or removed line to anchor a unique match. Add overwrites; Move renames. Returns a per-file summary.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'The full patch text with *** directives.' },
      },
      required: ['patch'],
    },
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command in the workspace root and return its (compressed) output. Timeout is 15 seconds; output is capped at ~2 MB. Prefer non-interactive commands (e.g. "npm test -- --runInBand", "npm run typecheck", "git status"). Explain to the user what a state-changing command will do before running it. This tool may require user approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute (e.g. "npm test", "git status").' },
      },
      required: ['command'],
    },
  },
  {
    name: 'todowrite',
    description:
      'Replace the current task list with a new list of todo items. Use this to track multi-step work: write the plan, mark items in_progress/completed as you go, and finish with a completed list. Items carry a status: pending, in_progress, completed, or canceled. IMPORTANT: todowrite is only for tracking — you must also execute each task using write_file, edit_file, apply_patch, or run_command. Never stop at just listing tasks.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full replacement task list.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Short description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'canceled'],
                description: 'Task status (defaults to pending).',
              },
            },
            required: ['content'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'todoread',
    description:
      'Read the current task list. Returns the todos written by todowrite, or a hint to create one. Call this at the start of a multi-step task to see what is left.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'skill',
    description:
      'Load the full instructions of an available agent skill by its name (from the available-skills list in the system prompt). Use a skill when the task matches its purpose — it contains the exact workflow to follow.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, e.g. "subagent-driven-development".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'webfetch',
    description:
      'Fetch a web page and return its text content (HTML stripped). Use it to look up documentation, read an article, or inspect a remote page. Only http/https URLs are allowed; the response is capped and compressed to keep tokens low. Batch independent fetches in a single response.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The http(s) URL to fetch.' },
        maxChars: { type: 'number', description: 'Optional output cap (default 8000 chars).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'websearch',
    description:
      'Search the web for a topic and return clean, ready-to-use results (Exa AI hosted MCP, no key required; enable with MUGIL_IDE_ENABLE_EXA=1). Use it to research current information, find docs, or answer questions beyond the model\'s training data. Prefer websearch for discovery and webfetch for retrieving a specific page.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        numResults: { type: 'number', description: 'Optional result count (default 5, capped at 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lsp',
    description:
      'Language-server code intelligence on a file position: goToDefinition, findReferences, or hover. Positions are 1-indexed (line 1 = first line, character 1 = first column — matching read_file). Returns matches as file:line:col entries (goToDefinition/findReferences) or the hover signature/documentation. Requires MUGIL_IDE_ENABLE_LSP=1 and typescript-language-server installed.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['goToDefinition', 'findReferences', 'hover'],
          description: 'The code-intelligence operation to run.',
        },
        path: { type: 'string', description: 'File path, relative to the workspace root or absolute inside the workspace.' },
        line: { type: 'number', description: '1-indexed line of the symbol (default 1).' },
        character: { type: 'number', description: '1-indexed column of the symbol (default 1).' },
      },
      required: ['operation', 'path'],
    },
  },
  {
    name: 'question',
    description:
      'Ask the user a question mid-task — for clarifying requirements, getting a decision, or offering implementation choices. Provide a short header, the question, and 2-6 concise options; the user picks one and it is returned as this tool\'s result. Use it only when a decision genuinely blocks progress.',
    parameters: {
      type: 'object',
      properties: {
        header: { type: 'string', description: 'Short label for the question (e.g. "Test runner").' },
        question: { type: 'string', description: 'The question to ask the user.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-6 concise answer options (one is returned as the answer).',
        },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: 'task',
    description:
      'Delegate a self-contained sub-task to a subagent with its own fresh context and tool loop (OpenCode-style). Use explore for read-only codebase research — it returns concise findings with file:line references. Use general for a full agent that can read, write, edit, and run commands (subject to the same approval policy). The subagent result is returned as this tool\'s output. Do not use task for work you can do directly in a few steps — it costs a separate model round-trip.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Clear, self-contained instructions for the subagent (include file paths and acceptance criteria).' },
        mode: {
          type: 'string',
          enum: ['explore', 'general'],
          description: 'explore = read-only research (default); general = full agent with write/command access (asks for approval).',
        },
      },
      required: ['description'],
    },
  },
];

/** Read-only policy for explore subagents (mirrors plan mode). */
const EXPLORE_POLICY = {
  tools: {
    write_file: 'deny' as const,
    edit_file: 'deny' as const,
    apply_patch: 'deny' as const,
    run_command: 'deny' as const,
    todowrite: 'deny' as const,
  },
  bash: { defaultAction: 'deny' as const, rules: [] },
};

const SUBAGENT_EXPLORE_PROMPT =
  'You are an explore subagent: a fast, read-only codebase researcher. ' +
  'Investigate the assigned question using read_file, list_files, search_code, codegraph, and skill. ' +
  'Return concise findings with file:line references and a short answer. Do not modify files or run commands.';

const SUBAGENT_GENERAL_PROMPT =
  'You are a general subagent: a focused coding agent completing a self-contained task. ' +
  'Use the workspace tools as needed; write/edit/command calls may require approval. ' +
  'Return the outcome concisely, including what changed and how it was verified.';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-packages', '.cache', '.turbo', 'build', 'coverage']);
const MAX_LINE_LENGTH = 2000;

// Web tools: webfetch is a direct fetch; websearch delegates to Exa AI's hosted
// MCP server (https://mcp.exa.ai/mcp) — the same no-key endpoint OpenCode uses.
const WEBFETCH_TIMEOUT_MS = 10_000;
const WEBFETCH_MAX_BYTES = 200_000;
const WEBSEARCH_MAX_RESULTS = 10;
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const EXA_TOOL_NAME = 'mcp__exa__web_search_exa';

/**
 * Lazily-created Exa MCP bundle, shared across calls (and retried on failure).
 * Keyed by connector so tests can inject distinct fakes; production always
 * passes `undefined` and gets a single shared bundle.
 */
const exaBundleCaches = new Map<McpConnector | undefined, Promise<McpToolsBundle>>();

function envTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/** Strips HTML down to readable text (scripts/styles removed, entities decoded). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One parsed patch directive. */
export interface PatchDirective {
  kind: 'add' | 'update' | 'delete' | 'move';
  /** Workspace-relative target path. */
  path: string;
  /** add: file content lines; update: hunk lines (-/+/space prefixed). */
  body: string[];
  /** move: rename target (workspace-relative). */
  moveTo?: string;
}

/**
 * Parses OpenCode-style patch text into directives. A `*** Move to:` line
 * renames the file named by the preceding `*** Update File:` header (and is
 * an error otherwise).
 */
export function parsePatch(patchText: string): PatchDirective[] {
  const directives: PatchDirective[] = [];
  const headerRe = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;
  let current: PatchDirective | null = null;
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(headerRe);
    if (match) {
      const kind = match[1] as 'Add File' | 'Update File' | 'Delete File' | 'Move to';
      if (kind === 'Move to') {
        const previous = directives[directives.length - 1];
        if (previous && previous.kind === 'update' && previous.body.length === 0 && !previous.moveTo) {
          previous.moveTo = match[2]!.trim();
        } else {
          directives.push({ kind: 'move', path: match[2]!.trim(), body: [], moveTo: undefined });
        }
        current = null;
        continue;
      }
      current = {
        kind: kind === 'Add File' ? 'add' : kind === 'Update File' ? 'update' : 'delete',
        path: match[2]!.trim(),
        body: [],
      };
      directives.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return directives.filter((d) => d.kind !== 'update' || d.body.length > 0 || d.moveTo);
}

/** Splits an update body into hunks (context + removed lines = search, added = replacement). */
export function parsePatchHunks(body: string[]): { before: string[]; after: string[] }[] {
  const hunks: { before: string[]; after: string[] }[] = [];
  let current: { before: string[]; after: string[] } | null = null;
  const flush = (): void => {
    if (current && (current.before.length > 0 || current.after.length > 0)) hunks.push(current);
    current = null;
  };
  for (const line of body) {
    if (line.startsWith('@@')) {
      flush();
      current = { before: [], after: [] };
      continue;
    }
    current = current ?? { before: [], after: [] };
    if (line.startsWith('-')) {
      current.before.push(line.slice(1));
    } else if (line.startsWith('+')) {
      current.after.push(line.slice(1));
    } else {
      const ctx = line.startsWith(' ') ? line.slice(1) : line;
      current.before.push(ctx);
      current.after.push(ctx);
    }
  }
  flush();
  return hunks;
}

function getExaBundle(connect: McpConnector | undefined): Promise<McpToolsBundle> {
  let cached = exaBundleCaches.get(connect);
  if (!cached) {
    const headers = process.env.MUGIL_IDE_EXA_API_KEY ? { 'x-api-key': process.env.MUGIL_IDE_EXA_API_KEY } : undefined;
    const configs: McpServerConfig[] = [
      { name: 'exa', url: EXA_MCP_URL, ...(headers ? { headers } : {}) },
    ];
    cached = (connect ? connectMcpServers(configs, connect) : connectMcpServers(configs)).catch((err: unknown) => {
      exaBundleCaches.delete(connect); // allow a later call to retry
      throw err;
    });
    exaBundleCaches.set(connect, cached);
  }
  return cached;
}
const BINARY_PROBE_BYTES = 8192;
const MAX_READ_LINES = 2000;

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'canceled';
}

/** Session task lists, keyed by workspace root (one list per open project). */
const todoStore = new Map<string, TodoItem[]>();

export interface WorkspaceToolsOptions {
  /** Run `tsc --noEmit` after writes/edits and feed errors back (default false). */
  diagnostics?: boolean;
  /** Injectable diagnostics runner (tests). Defaults to `runDiagnostics`. */
  runDiagnostics?: (root: string) => DiagnosticsResult;
  /** Handoff used by the `task` tool to run subagents (required for task). */
  handoff?: HandoffManager;
  /** Permission check applied inside the subagent loop (general mode). */
  subagentPermission?: PermissionCheck;
  /** Model for subagent completions (defaults to the handoff ladder). */
  subagentModel?: string;
  /** Subagent loop bound. Default 4. */
  subagentMaxIterations?: number;
  /**
   * Fired for each tool call executed inside a subagent loop (mode + call),
   * so the caller can stream subagent progress (e.g. into a live status line).
   */
  onSubagentTool?: (mode: 'explore' | 'general', call: ToolCall) => void;
  /** Injectable fetch for webfetch (tests). Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Injectable Exa MCP connector for websearch (tests). */
  websearchConnect?: McpConnector;
  /**
   * Enable the websearch tool (defaults to `MUGIL_IDE_ENABLE_EXA=1`). It
   * delegates to Exa AI's hosted MCP server (https://mcp.exa.ai/mcp) — no key
   * needed for casual use; set MUGIL_IDE_EXA_API_KEY to lift rate limits.
   */
  websearchEnabled?: boolean;
  /**
   * Interactive handler for the `question` tool. Returns the user's chosen
   * option. Without it the tool answers that no handler is wired, so headless
   * callers never hang waiting on a human.
   */
  onQuestion?: (q: { header?: string; question: string; options: string[] }) => Promise<string>;
  /**
   * Enable the `lsp` tool (defaults to `MUGIL_IDE_ENABLE_LSP=1`). Requires a
   * language server on PATH (`typescript-language-server`).
   */
  lspEnabled?: boolean;
  /** Injectable LSP client factory (tests). Defaults to the stdio client. */
  lspConnect?: (root: string) => Promise<LspClient>;
}

export function extractCodeSkeleton(content: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/);
  const out: string[] = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    let inBlockComment = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (inBlockComment) {
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        continue;
      }
      if (trimmed.startsWith('//')) {
        continue;
      }

      // Track braces
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;

      // Imports / exports
      if (trimmed.startsWith('import ') || trimmed.startsWith('export *') || trimmed.startsWith('export default')) {
        out.push(`${i + 1}: ${trimmed}`);
        braceDepth += (opens - closes);
        continue;
      }

      // Interface / Type / Enum definitions
      if (/^(export\s+)?(type|interface|enum)\s+/.test(trimmed)) {
        out.push(`${i + 1}: ${line}`);
        braceDepth += (opens - closes);
        continue;
      }

      // Class / Abstract Class
      if (/^(export\s+)?(abstract\s+)?class\s+/.test(trimmed)) {
        out.push(`${i + 1}: ${line.replace(/\{.*$/, '{')}`);
        braceDepth += (opens - closes);
        continue;
      }

      // Function / Method declarations
      if (
        /^(export\s+)?(async\s+)?function(\s+\w+)?\s*\(/.test(trimmed) ||
        /^(public|private|protected|static|override|async|readonly)*\s*(get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(:\s*[^{;]+)?\s*(\{|;|$)/.test(trimmed) ||
        /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*(=>|:)/.test(trimmed)
      ) {
        if (opens > 0 && closes >= opens) {
          out.push(`${i + 1}: ${line.replace(/\{.*\}/, '{ … }')}`);
        } else if (opens > 0) {
          out.push(`${i + 1}: ${line.replace(/\{.*$/, '{ … }')}`);
        } else {
          out.push(`${i + 1}: ${trimmed}`);
        }
        braceDepth += (opens - closes);
        continue;
      }

      // Inside interface / type / class top-level
      if (braceDepth === 1 && (trimmed.endsWith(';') || trimmed.endsWith(','))) {
        out.push(`${i + 1}: ${line}`);
      } else if (braceDepth > 0 && closes > 0 && braceDepth - closes === 0) {
        out.push(`${i + 1}: ${line}`);
      }

      braceDepth = Math.max(0, braceDepth + opens - closes);
    }
    return out.join('\n') || lines.slice(0, 50).map((l, i) => `${i + 1}: ${l}`).join('\n');
  }

  if (['.py'].includes(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (
        trimmed.startsWith('class ') ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('async def ') ||
        trimmed.startsWith('import ') ||
        trimmed.startsWith('from ') ||
        trimmed.startsWith('@')
      ) {
        out.push(`${i + 1}: ${line}`);
      }
    }
    return out.join('\n') || lines.slice(0, 50).map((l, i) => `${i + 1}: ${l}`).join('\n');
  }

  // Fallback for general languages
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (
      /^(pub\s+)?(fn|struct|enum|trait|impl|type)\s+/.test(trimmed) ||
      /^(func|type|struct|interface)\s+/.test(trimmed) ||
      /^(public|private|protected|class|interface|void|int|string|boolean)/.test(trimmed)
    ) {
      out.push(`${i + 1}: ${line}`);
    }
  }
  return out.join('\n') || lines.slice(0, 50).map((l, i) => `${i + 1}: ${l}`).join('\n');
}

export function createWorkspaceTools(
  workspaceRoot: string = process.cwd(),
  options: WorkspaceToolsOptions = {},
): {
  tools: ToolDefinition[];
  toolRegistry: ToolRegistry;
} {
  const root = path.resolve(workspaceRoot);
  const diagnosticsEnabled = options.diagnostics ?? false;
  const diagnosticsRunner = options.runDiagnostics ?? ((r: string) => runDiagnostics(r));
  const subagentMaxIterations = options.subagentMaxIterations ?? 4;
  const websearchEnabled = options.websearchEnabled ?? envTruthy(process.env.MUGIL_IDE_ENABLE_EXA);
  const lspEnabled = options.lspEnabled ?? envTruthy(process.env.MUGIL_IDE_ENABLE_LSP);

  /** Appends post-edit typecheck diagnostics to a successful tool result. */
  function withDiagnostics(base: string): string {
    if (!diagnosticsEnabled) return base;
    const result = diagnosticsRunner(root);
    if (!result.ran) return base;
    if (result.output.trim().length === 0) {
      return `${base}\n\n[typecheck] ✓ no type errors detected.`;
    }
    return `${base}\n\n[typecheck] errors found:\n${result.output}`;
  }

  /** Resolves a tool-supplied path and enforces containment inside the root. */
  function resolveInWorkspace(rawPath: string): { target: string; error?: string } {
    const normalizedRoot = path.resolve(root);
    const target = path.resolve(normalizedRoot, rawPath);
    const rel = path.relative(normalizedRoot, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { target, error: `Error: path "${rawPath}" is outside the workspace root (${normalizedRoot}). Paths must stay inside the workspace.` };
    }
    return { target };
  }

  function isBinaryFile(target: string): boolean {
    try {
      const fd = fs.openSync(target, 'r');
      try {
        const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
        const read = fs.readSync(fd, buffer, 0, BINARY_PROBE_BYTES, 0);
        return buffer.subarray(0, read).includes(0);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  const registry: ToolRegistry = {
    read_file: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { path: string; startLine?: number; endLine?: number };
      if (!args.path) return 'Error: path parameter is required.';
      const { target, error } = resolveInWorkspace(args.path);
      if (error) return error;
      if (!fs.existsSync(target)) {
        return `Error: file not found: ${args.path}`;
      }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        return `Error: ${args.path} is a directory, use list_files instead.`;
      }
      if (isBinaryFile(target)) {
        return `Error: ${args.path} appears to be a binary file and cannot be read as text.`;
      }
      const content = fs.readFileSync(target, 'utf-8');
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, args.startLine ?? 1);
      const end = Math.min(lines.length, args.endLine ?? lines.length);
      const slice = lines.slice(start - 1, end).slice(0, MAX_READ_LINES);
      const rendered = slice.map((line, idx) => {
        const num = start + idx;
        const text = line.length > MAX_LINE_LENGTH ? `${line.substring(0, MAX_LINE_LENGTH)}…` : line;
        return `${num}: ${text}`;
      });
      let out = rendered.join('\n');
      if (end > start - 1 + rendered.length) {
        out += `\n… (file has more lines; use startLine/endLine to read beyond line ${start - 1 + rendered.length})`;
      }
      return out;
    },

    read_skeleton: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { path: string };
      if (!args.path) return 'Error: path parameter is required.';
      const { target, error } = resolveInWorkspace(args.path);
      if (error) return error;
      if (!fs.existsSync(target)) {
        return `Error: file not found: ${args.path}`;
      }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        return `Error: ${args.path} is a directory, use list_files instead.`;
      }
      if (isBinaryFile(target)) {
        return `Error: ${args.path} appears to be a binary file and cannot be read as text.`;
      }
      const content = fs.readFileSync(target, 'utf-8');
      const skeleton = extractCodeSkeleton(content, target);
      return compressCommandOutput(skeleton, { maxLineLength: 300 }).text;
    },

    list_files: async (call: ToolCall): Promise<string> => {
      const args = (parseToolArguments(call) as { dir?: string; pattern?: string }) || {};
      let targetDir = root;
      if (args.dir) {
        const resolved = resolveInWorkspace(args.dir);
        if (resolved.error) return resolved.error;
        targetDir = resolved.target;
      }
      if (!fs.existsSync(targetDir)) {
        return `Error: directory not found: ${args.dir ?? '.'}`;
      }
      const results: string[] = [];

      function walk(current: string) {
        if (results.length >= 80) return;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const fullPath = path.join(current, entry.name);
          const rel = path.relative(root, fullPath).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            if (!args.pattern || rel.toLowerCase().includes(args.pattern.toLowerCase())) {
              results.push(rel);
            }
          }
        }
      }

      walk(targetDir);
      if (results.length === 0) return '(no matching files found)';
      // rtk-style compression: collapses repeated lines and truncates very
      // long paths so a big tree does not blow the context window.
      return compressCommandOutput(results.join('\n'), { maxLineLength: 400 }).text;
    },

    search_code: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { query: string; extension?: string };
      if (!args.query) return 'Error: query parameter is required.';
      const matches: Array<{ file: string; line: number; text: string }> = [];
      const queryLower = args.query.toLowerCase();

      function walk(current: string) {
        if (matches.length >= 40) return;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            if (args.extension && !entry.name.endsWith(`.${args.extension.replace(/^\./, '')}`)) {
              continue;
            }
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= 40) break;
                if (lines[i]!.toLowerCase().includes(queryLower)) {
                  const rel = path.relative(root, fullPath).replace(/\\/g, '/');
                  matches.push({ file: rel, line: i + 1, text: lines[i]!.trim() });
                }
              }
            } catch {
              // skip binary or unreadable files
            }
          }
        }
      }

      walk(root);
      if (matches.length === 0) return `(no matches found for "${args.query}")`;

      // Group matches by file
      const grouped = new Map<string, Array<{ line: number; text: string }>>();
      for (const m of matches) {
        if (!grouped.has(m.file)) grouped.set(m.file, []);
        grouped.get(m.file)!.push({ line: m.line, text: m.text });
      }

      const formatted: string[] = [];
      for (const [file, hits] of grouped.entries()) {
        formatted.push(`📁 ${file} (${hits.length} match${hits.length > 1 ? 'es' : ''}):`);
        for (const h of hits) {
          const truncated =
            h.text.length > 200 ? `${h.text.slice(0, 200)}… (+${h.text.length - 200} chars)` : h.text;
          formatted.push(`  L${h.line}: ${truncated}`);
        }
      }

      return compressCommandOutput(formatted.join('\n'), { maxLineLength: 400 }).text;
    },

    codegraph: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { query: string };
      if (!args.query) return 'Error: query parameter is required.';
      const graph = buildCodeGraph(root);
      const queryResults = queryCodeGraph(graph, args.query, { top: 10 });
      const lines = [
        `CodeGraph Analysis for "${args.query}":`,
        `Top Relevant Symbols (${queryResults.length}):`,
        ...queryResults.map(
          (r) =>
            `  • [${r.symbol.kind}] ${r.symbol.name} (${r.symbol.file}:${r.symbol.line}) - ${r.symbol.signature} (score: ${r.score})`,
        ),
      ];
      return lines.join('\n');
    },

    write_file: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { path: string; content: string };
      if (!args.path || args.content === undefined) return 'Error: path and content parameters are required.';
      const { target, error } = resolveInWorkspace(args.path);
      if (error) return error;
      // Snapshot the pre-write state so /undo can revert this edit.
      const before = captureFile(root, target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content, 'utf-8');
      const undoNote = pushEdit(root, { path: target, before, after: { content: args.content, existed: true } });
      const rel = path.relative(root, target).replace(/\\/g, '/');
      return withDiagnostics(`✓ Successfully wrote ${Buffer.byteLength(args.content, 'utf-8')} bytes to ${rel}${undoNote ? ` (${undoNote})` : ''}`);
    },

    edit_file: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { path: string; target: string; replacement: string };
      if (!args.path || !args.target || args.replacement === undefined) {
        return 'Error: path, target, and replacement parameters are required.';
      }
      const { target, error } = resolveInWorkspace(args.path);
      if (error) return error;
      if (!fs.existsSync(target)) {
        return `Error: file not found: ${args.path}`;
      }
      const content = fs.readFileSync(target, 'utf-8');
      const occurrences = content.split(args.target).length - 1;
      if (occurrences === 0) {
        return `Error: target text block not found in ${args.path}. Ensure exact indentation and character match.`;
      }
      if (occurrences > 1) {
        return `Error: target text block found ${occurrences} times in ${args.path}. Provide more surrounding context lines to make it unique.`;
      }
      // Snapshot the pre-edit state so /undo can revert this edit.
      const before = captureFile(root, target);
      const updated = content.replace(args.target, args.replacement);
      fs.writeFileSync(target, updated, 'utf-8');
      const undoNote = pushEdit(root, { path: target, before, after: { content: updated, existed: true } });
      const rel = path.relative(root, target).replace(/\\/g, '/');
      return withDiagnostics(`✓ Successfully edited ${rel}${undoNote ? ` (${undoNote})` : ''}`);
    },

    apply_patch: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { patch: string };
      if (!args.patch) return 'Error: patch parameter is required.';
      const directives = parsePatch(args.patch);
      if (directives.length === 0) {
        return 'Error: empty patch — no *** directives (Add File / Update File / Delete File / Move to) found.';
      }
      const results: string[] = [];
      for (const d of directives) {
        if (d.kind === 'add') {
          const { target, error } = resolveInWorkspace(d.path);
          if (error) return error;
          const before = captureFile(root, target);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const content = d.body.join('\n') + '\n';
          fs.writeFileSync(target, content, 'utf-8');
          const undoNote = pushEdit(root, { path: target, before, after: { content, existed: true } });
          results.push(`✓ Added ${path.relative(root, target).replace(/\\/g, '/')}${undoNote ? ` (${undoNote})` : ''}`);
        } else if (d.kind === 'update') {
          const { target, error } = resolveInWorkspace(d.path);
          if (error) return error;
          if (!fs.existsSync(target)) return `Error: update target not found: ${d.path}`;
          const before = captureFile(root, target);
          let content = fs.readFileSync(target, 'utf-8');
          const hunks = parsePatchHunks(d.body);
          if (d.moveTo && hunks.length === 0) {
            // Pure rename: update header followed by *** Move to:
            const dest = resolveInWorkspace(d.moveTo);
            if (dest.error) return dest.error;
            if (fs.existsSync(dest.target)) return `Error: move target already exists: ${d.moveTo}`;
            fs.mkdirSync(path.dirname(dest.target), { recursive: true });
            fs.renameSync(target, dest.target);
            // Record the destination so undo removes the moved copy (no
            // duplicate) and redo re-creates it (no lost file).
            const undoNote = pushEdit(root, {
              path: target,
              before,
              after: { content: '', existed: false },
              movedTo: dest.target,
            });
            results.push(`✓ Moved ${d.path} → ${d.moveTo}${undoNote ? ` (${undoNote})` : ''}`);
            continue;
          }
          for (const hunk of hunks) {
            const search = hunk.before.join('\n');
            if (search.length === 0) {
              return `Error: hunk in ${d.path} has no context or removed lines — include a line to anchor the match.`;
            }
            const occurrences = content.split(search).length - 1;
            if (occurrences === 0) return `Error: hunk not found in ${d.path}.`;
            if (occurrences > 1) {
              return `Error: hunk matches ${occurrences} times in ${d.path} — add more surrounding context.`;
            }
            content = content.replace(search, hunk.after.join('\n'));
          }
          fs.writeFileSync(target, content, 'utf-8');
          const undoNote = pushEdit(root, { path: target, before, after: { content, existed: true } });
          results.push(`✓ Updated ${path.relative(root, target).replace(/\\/g, '/')} (${hunks.length} hunk${hunks.length === 1 ? '' : 's'})${undoNote ? ` (${undoNote})` : ''}`);
        } else if (d.kind === 'delete') {
          const { target, error } = resolveInWorkspace(d.path);
          if (error) return error;
          if (!fs.existsSync(target)) return `Error: delete target not found: ${d.path}`;
          const before = captureFile(root, target);
          fs.rmSync(target, { force: true });
          const undoNote = pushEdit(root, { path: target, before, after: { content: '', existed: false } });
          results.push(`✓ Deleted ${d.path}${undoNote ? ` (${undoNote})` : ''}`);
        } else if (d.kind === 'move') {
          return 'Error: *** Move to: must follow an empty *** Update File: block (rename the updated file).';
        }
      }
      return withDiagnostics(results.join('\n'));
    },

    run_command: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { command: string };
      if (!args.command) return 'Error: command parameter is required.';
      try {
        const stdout = execSync(args.command, {
          cwd: root,
          timeout: 15000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return compressCommandOutput(stdout).text;
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        const combined = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
        return compressCommandOutput(`Command failed:\n${combined}`).text;
      }
    },

    todowrite: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { todos?: TodoItem[] };
      const todos = Array.isArray(args.todos)
        ? args.todos
            .filter((t) => t && typeof t.content === 'string' && t.content.trim().length > 0)
            .map((t) => ({
              content: t.content.trim(),
              status: t.status && ['pending', 'in_progress', 'completed', 'canceled'].includes(t.status)
                ? t.status
                : ('pending' as const),
            }))
        : [];
      todoStore.set(root, todos);
      return todos.length > 0
        ? `✓ Task list updated (${todos.length} items).`
        : '✓ Task list cleared.';
    },

    todoread: async (_call: ToolCall): Promise<string> => {
      const todos = todoStore.get(root) ?? [];
      if (todos.length === 0) {
        return '(no todos yet — use todowrite to create a task list for multi-step work)';
      }
      const mark: Record<TodoItem['status'], string> = {
        pending: ' ',
        in_progress: '~',
        completed: 'x',
        canceled: '-',
      };
      const lines = todos.map((t, i) => `  [${mark[t.status]}] ${i + 1}. ${t.content} (${t.status})`);
      return `Todo list (${todos.length}):\n${lines.join('\n')}`;
    },

    skill: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { name: string };
      if (!args.name) return 'Error: name parameter is required.';
      const content = loadSkill(root, args.name);
      if (content === null) {
        const available = discoverSkills(root)
          .map((s) => s.name)
          .join(', ');
        return `Error: unknown skill "${args.name}". Available skills: ${available || '(none)'}`;
      }
      return content;
    },

    webfetch: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { url: string; maxChars?: number };
      if (!args.url) return 'Error: url parameter is required.';
      let parsed: URL;
      try {
        parsed = new URL(args.url);
      } catch {
        return `Error: invalid URL: ${args.url}`;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Error: only http:// and https:// URLs are supported (got ${parsed.protocol}//).`;
      }
      const fetchFn = options.fetchFn ?? globalThis.fetch;
      try {
        const response = await fetchFn(parsed, {
          redirect: 'follow',
          signal: AbortSignal.timeout(WEBFETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText} for ${args.url}`;
        }
        const contentType = response.headers.get('content-type') ?? '';
        const isText =
          contentType === '' ||
          /^(text\/|application\/(json|xml|xhtml\+xml|javascript))/.test(contentType);
        const raw = await response.text();
        if (!isText) {
          return `[non-text content (${contentType || 'unknown'}) — cannot render]`;
        }
        const text = htmlToText(raw.slice(0, WEBFETCH_MAX_BYTES));
        const limit = Math.max(1000, Math.min(20_000, args.maxChars ?? 8000));
        const truncated =
          text.length > limit
            ? `${text.slice(0, limit)}\n… (truncated at ${limit} chars; pass maxChars to adjust)`
            : text;
        return compressCommandOutput(truncated, { maxLineLength: 400 }).text || '(empty page)';
      } catch (err: unknown) {
        return `Error: webfetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    websearch: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { query: string; numResults?: number };
      if (!args.query) return 'Error: query parameter is required.';
      if (!websearchEnabled) {
        return 'Error: websearch is disabled. Set MUGIL_IDE_ENABLE_EXA=1 to enable (uses Exa AI hosted MCP, no key required for casual use).';
      }
      try {
        const bundle = await getExaBundle(options.websearchConnect);
        const executor = bundle.registry[EXA_TOOL_NAME];
        if (!executor) {
          return `Error: websearch unavailable (${bundle.errors.join('; ') || `Exa server exposed no ${EXA_TOOL_NAME} tool`}).`;
        }
        const numResults = Math.max(1, Math.min(WEBSEARCH_MAX_RESULTS, args.numResults ?? 5));
        const out = await executor({
          id: call.id,
          name: EXA_TOOL_NAME,
          arguments: JSON.stringify({ query: args.query, numResults }),
        });
        return out.length > 8000 ? `${out.slice(0, 8000)}\n… (search results truncated at 8000 chars)` : out;
      } catch (err: unknown) {
        return `Error: websearch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    lsp: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as {
        operation?: string;
        path: string;
        line?: number;
        character?: number;
      };
      const operations = ['goToDefinition', 'findReferences', 'hover'];
      if (!args.operation || !operations.includes(args.operation)) {
        return `Error: operation must be one of: ${operations.join(', ')}.`;
      }
      if (!args.path) return 'Error: path parameter is required.';
      if (!lspEnabled) {
        return 'Error: the lsp tool is disabled. Set MUGIL_IDE_ENABLE_LSP=1 and install a language server (npm i -g typescript-language-server).';
      }
      const { target, error } = resolveInWorkspace(args.path);
      if (error) return error;
      if (!fs.existsSync(target)) return `Error: file not found: ${args.path}`;
      const line = Math.max(0, (args.line ?? 1) - 1);
      const character = Math.max(0, (args.character ?? 1) - 1);
      try {
        const client = await getLspClient(root, options.lspConnect);
        const op = args.operation as 'goToDefinition' | 'findReferences' | 'hover';
        const out = await client[op](target, line, character);
        return compressCommandOutput(out, { maxLineLength: 400 }).text;
      } catch (err) {
        return `Error: LSP request failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    question: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { header?: string; question: string; options?: string[] };
      if (!args.question) return 'Error: question parameter is required.';
      const choices = Array.isArray(args.options)
        ? args.options.filter((o) => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim()).slice(0, 6)
        : [];
      if (choices.length < 2) {
        return 'Error: provide 2-6 answer options for the user to choose from.';
      }
      if (!options.onQuestion) {
        return 'Error: no interactive question handler is wired (headless mode) — decide yourself or proceed with the most reasonable option.';
      }
      try {
        const answer = await options.onQuestion({ header: args.header, question: args.question, options: choices });
        return `User answered: ${answer}`;
      } catch (err) {
        return `Error: question failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    task: async (call: ToolCall): Promise<string> => {
      const args = parseToolArguments(call) as { description: string; mode?: 'explore' | 'general' };
      if (!args.description) return 'Error: description parameter is required.';
      if (!options.handoff) {
        return 'Error: the task tool needs a handoff (engine) wired in to run subagents.';
      }
      const mode = args.mode === 'general' ? 'general' : 'explore';
      const subTools = WORKSPACE_TOOL_DEFINITIONS.filter(
        (t) =>
          t.name !== 'task' &&
          (websearchEnabled || t.name !== 'websearch') &&
          (lspEnabled || t.name !== 'lsp'),
      );
      const subRegistry: ToolRegistry = { ...registry };
      delete subRegistry.task;
      const subPermission =
        mode === 'explore'
          ? createPermissionCheck(EXPLORE_POLICY)
          : (options.subagentPermission ?? createPermissionCheck(defaultPolicyForMode('act')));
      const loop = new ToolLoop({
        handoff: options.handoff,
        maxIterations: subagentMaxIterations,
        // Stream the subagent's internal tool calls to the caller (live status).
        onTool: (call) => options.onSubagentTool?.(mode, call),
      });
      const result = await loop.run(
        [
          { role: 'system', content: mode === 'explore' ? SUBAGENT_EXPLORE_PROMPT : SUBAGENT_GENERAL_PROMPT },
          { role: 'user', content: args.description },
        ],
        {
          tools: subTools,
          registry: subRegistry,
          permission: subPermission,
          preferredModel: options.subagentModel,
          maxTokens: 2048,
        },
      );
      let content = result.content.trim();
      if (content.length === 0) return `[subagent (${mode}) returned no text]`;
      if (content.length > 4000) {
        content = `${content.slice(0, 4000)}\n… (subagent output truncated at 4000 chars)`;
      }
      return compressCommandOutput(cavemanStrategy(content).text, { maxLineLength: 400 }).text;
    },
  };

  return {
    // websearch is env-gated (MUGIL_IDE_ENABLE_EXA) so it is only offered to
    // the model when actually usable — a model without it wastes no tokens on
    // tool requests that would be denied.
    tools:
      websearchEnabled && lspEnabled
        ? WORKSPACE_TOOL_DEFINITIONS
        : WORKSPACE_TOOL_DEFINITIONS.filter(
            (t) =>
              (websearchEnabled || t.name !== 'websearch') &&
              (lspEnabled || t.name !== 'lsp'),
          ),
    toolRegistry: registry,
  };
}
