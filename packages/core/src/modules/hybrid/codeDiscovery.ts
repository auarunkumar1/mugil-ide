import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildCodeGraph, queryCodeGraph } from '../codegraph/index.js';
import { extractCodeSkeleton } from '../tools/workspaceTools.js';
import { countTokens } from '../../token/tokenizer.js';
import type { DenseContextCapsule, DiscoveredSymbol } from './types.js';

export interface CodeDiscoveryOptions {
  maxTokens?: number; // default: 1200
  topK?: number; // default: 5
}

/**
 * Deterministic CodeGraph Anchor (Risk 1 Mitigation):
 * Discovers relevant symbols and generates a bounded dense context capsule.
 * Enforces an open-door contract so the cloud model can always fall back to read_file.
 */
export async function discoverDenseContext(
  workspaceDir: string,
  prompt: string,
  options?: CodeDiscoveryOptions,
): Promise<{ capsule: DenseContextCapsule; confidence: number }> {
  const maxTokens = options?.maxTokens ?? 1200;
  const topK = options?.topK ?? 5;

  let graph;
  try {
    graph = buildCodeGraph(workspaceDir);
  } catch {
    // If graph build fails (e.g. non-code workspace), return minimal empty capsule
    return {
      confidence: 0,
      capsule: {
        taskSummary: prompt.slice(0, 100),
        discoveredSymbols: [],
        contextSnippet: '',
        openDoorContract: 'Pre-flight found no symbols. Use standard read_file to inspect files.',
        suggestedTools: ['read_file', 'edit_file'],
        estimatedSavings: { toolPruning: 0, hybridRecon: 0 },
      },
    };
  }

  const queryResults = queryCodeGraph(graph, prompt, { top: topK });
  const confidence = queryResults.length > 0 ? queryResults[0]!.score : 0;

  const discoveredSymbols: DiscoveredSymbol[] = [];
  const processedFiles = new Set<string>();
  const snippetParts: string[] = [];
  let currentTokens = 0;

  for (const res of queryResults) {
    const sym = res.symbol;
    const relFile = path.isAbsolute(sym.file) ? path.relative(workspaceDir, sym.file) : sym.file;

    discoveredSymbols.push({
      name: sym.name,
      file: relFile,
      kind: sym.kind,
      line: sym.line,
      signature: sym.signature,
    });

    // Surgical symbol outline
    const symHeader = `### Symbol: ${sym.name} (${sym.kind || 'code'}) in ${relFile}:${sym.line}\n` +
      `\`\`\`\n${sym.signature || sym.snippet || sym.name}\n\`\`\`\n`;
    const symTokens = countTokens(symHeader);

    if (currentTokens + symTokens <= maxTokens) {
      snippetParts.push(symHeader);
      currentTokens += symTokens;
    } else {
      // Reached budget
      snippetParts.push(`\n<!-- Context capsule truncated at ${maxTokens} token limit -->\n`);
      break;
    }

    // Add skeleton of the top file if budget permits
    const fullFilePath = path.isAbsolute(sym.file) ? sym.file : path.join(workspaceDir, sym.file);
    if (!processedFiles.has(fullFilePath) && processedFiles.size < 2 && fs.existsSync(fullFilePath)) {
      processedFiles.add(fullFilePath);
      try {
        const fileContent = fs.readFileSync(fullFilePath, 'utf8');
        const skeleton = extractCodeSkeleton(fileContent, fullFilePath);
        const skelHeader = `### File Outline: ${relFile}\n\`\`\`\n${skeleton}\n\`\`\`\n`;
        const skelTokens = countTokens(skelHeader);

        if (currentTokens + skelTokens <= maxTokens) {
          snippetParts.push(skelHeader);
          currentTokens += skelTokens;
        } else {
          // Truncate skeleton to fit remaining budget
          const remaining = maxTokens - currentTokens;
          if (remaining > 50) {
            const lines = skeleton.split('\n');
            const truncatedLines: string[] = [];
            let tCount = 0;
            for (const l of lines) {
              const lt = countTokens(l);
              if (tCount + lt > remaining - 20) break;
              truncatedLines.push(l);
              tCount += lt;
            }
            if (truncatedLines.length > 0) {
              snippetParts.push(
                `### File Outline: ${relFile} (partial)\n\`\`\`\n${truncatedLines.join('\n')}\n...\n\`\`\`\n`,
              );
              currentTokens += tCount;
            }
          }
          snippetParts.push(`\n<!-- Context capsule truncated at ${maxTokens} token limit -->\n`);
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const symbolNames = discoveredSymbols.map((s) => s.name);
  const openDoorContract = symbolNames.length > 0
    ? `Pre-flight discovered symbols [${symbolNames.join(', ')}]. If you require additional files or complete file contents to complete this task safely, call read_file.`
    : 'Pre-flight found no high-confidence symbols. If you require file contents, call read_file.';

  // Avoided exploratory recon tokens: ~400 tokens per symbol identified (avoiding tool calls)
  const avoidedReconTokens = Math.min(3000, discoveredSymbols.length * 400);

  return {
    confidence,
    capsule: {
      taskSummary: prompt.trim().split('\n')[0] || prompt.slice(0, 100),
      discoveredSymbols,
      contextSnippet: snippetParts.join('\n'),
      openDoorContract,
      suggestedTools: ['read_file', 'edit_file', 'apply_patch'],
      estimatedSavings: {
        toolPruning: 0,
        hybridRecon: avoidedReconTokens,
      },
    },
  };
}
