import type { ToolDefinition } from '../../types.js';
import { countTokens } from '../../token/tokenizer.js';
import type { ToolBundleName } from './types.js';

export const TOOL_BUNDLES: Record<ToolBundleName, readonly string[]> = {
  CORE_EDITING: ['read_file', 'write_file', 'edit_file', 'apply_patch', 'read_blob'] as const,
  TERMINAL: ['run_command'] as const,
  EXPLORATION: ['list_files', 'search_code', 'codegraph', 'read_symbol', 'read_skeleton'] as const,
  MEDIA: ['generate_image'] as const,
  EXTENSIONS: ['websearch', 'webfetch', 'lsp', 'todowrite', 'todoread', 'question', 'task', 'skill'] as const,
};

/** All tools categorized in known bundles */
const ALL_BUNDLED_TOOLS = new Set<string>(
  Object.values(TOOL_BUNDLES).flatMap((b) => b),
);

/**
 * Deterministically decides which tool bundles to activate based on prompt analysis
 * and CodeGraph confidence score.
 */
export function determineActiveBundles(
  prompt: string,
  codeGraphConfidence?: number,
): ToolBundleName[] {
  const bundles: Set<ToolBundleName> = new Set();

  // 1. Immutable core: CORE_EDITING is always active under all circumstances
  bundles.add('CORE_EDITING');

  const lower = prompt.toLowerCase();

  // 2. Terminal: active if prompt mentions test, build, run, terminal, compile, package managers
  if (/\b(test|tests|build|run|exec|execute|terminal|compile|npm|npx|yarn|pnpm|cargo|pytest|pip|make|bash|sh|script)\b/i.test(lower)) {
    bundles.add('TERMINAL');
  }

  // 3. Exploration: active if CodeGraph confidence score is low (< 15) or prompt indicates search/discovery
  if (
    (typeof codeGraphConfidence === 'number' && codeGraphConfidence < 15) ||
    /\b(where|find|search|look|explore|discover|locate|which file|list|overview|grep|pending|check|inspect|show|status|audit)\b/i.test(lower)
  ) {
    bundles.add('EXPLORATION');
  }

  // 4. Media: active only if media/diagram/image is explicitly requested
  if (/\b(image|picture|photo|draw|diagram|generate_image|illustration|svg|screenshot|media)\b/i.test(lower)) {
    bundles.add('MEDIA');
  }

  // 5. Extensions: active if web/research or task management keywords appear
  if (/\b(web|browse|url|http|https|fetch|google|online|task|todo|checklist|skill|lsp|points|plan|broken)\b/i.test(lower)) {
    bundles.add('EXTENSIONS');
  }

  return Array.from(bundles);
}

export interface PruneResult {
  tools: ToolDefinition[];
  prunedTokens: number;
  activeToolNames: string[];
  prunedToolNames: string[];
}

/**
 * Filters tool definitions according to active bundles.
 * Immutable core tools are never removed.
 * Custom MCP tools not registered in any predefined bundle are preserved.
 */
export function pruneToolSchemas(
  allTools: ToolDefinition[],
  activeBundles: ToolBundleName[],
): PruneResult {
  const allowedNames = new Set<string>();

  // Always enforce CORE_EDITING
  for (const tool of TOOL_BUNDLES.CORE_EDITING) {
    allowedNames.add(tool);
  }

  for (const bundle of activeBundles) {
    const tools = TOOL_BUNDLES[bundle];
    if (tools) {
      for (const t of tools) allowedNames.add(t);
    }
  }

  const keptTools: ToolDefinition[] = [];
  const prunedToolNames: string[] = [];
  let prunedTokens = 0;

  for (const tool of allTools) {
    const isBundled = ALL_BUNDLED_TOOLS.has(tool.name);
    if (!isBundled || allowedNames.has(tool.name)) {
      keptTools.push(tool);
    } else {
      prunedToolNames.push(tool.name);
      try {
        const schemaText = JSON.stringify(tool);
        prunedTokens += countTokens(schemaText);
      } catch {
        prunedTokens += 150; // fallback token estimate
      }
    }
  }

  return {
    tools: keptTools,
    prunedTokens,
    activeToolNames: keptTools.map((t) => t.name),
    prunedToolNames,
  };
}
