/**
 * Environment Context
 * ===================
 * Builds the agent's environment context block for the system prompt:
 * working directory, platform, today's date, and project context files
 * (AGENTS.md / CLAUDE.md) found walking up from the workspace root.
 *
 * This follows the established coding-agent pattern (OpenCode
 * `SystemPrompt.environment()` + `SystemPrompt.custom()`): models answer
 * better when they know where they run and what conventions the repo
 * already encodes.
 *
 * Credit: pattern inspired by OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Project convention files loaded into the agent's context (nearest wins). */
export const PROJECT_CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md'];

/** Per-file cap so a runaway AGENTS.md cannot blow the token budget. */
const MAX_FILE_CHARS = 100_000;

export interface ProjectContextFile {
  /** Absolute path of the file. */
  file: string;
  content: string;
}

/** Builds the environment context block for the system prompt. */
export function buildEnvironmentContext(cwd: string = process.cwd()): string {
  const resolved = path.resolve(cwd);
  const parts: string[] = [
    `Working directory: ${resolved}`,
    `Platform: ${os.platform()} (${os.release()})`,
    `Today's date: ${new Date().toDateString()}`,
  ];

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const topFiles = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== 'coverage')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .slice(0, 50);

    if (topFiles.length > 0) {
      parts.push(`Top-level workspace files & directories:\n${topFiles.join(', ')}`);
    }

    // Explicitly scan for known todo or planning markdown files in root
    const todoFiles = entries
      .filter(
        (e) =>
          e.isFile() &&
          /(^|[^a-z0-9])(todo|todos|roadmap|tasks|pending|plan)([^a-z0-9]|$)/i.test(e.name) &&
          e.name.endsWith('.md'),
      )
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    if (todoFiles.length > 0) {
      parts.push(`Workspace Todo / Planning Markdown Files: ${todoFiles.join(', ')}`);
    } else {
      parts.push('Workspace Todo / Planning Markdown Files: None in root directory (use list_files or search_code to inspect subdirectories).');
    }
  } catch {
    /* ignore read errors on virtual or inaccessible roots */
  }

  for (const { file, content } of findProjectContextFiles(cwd)) {
    parts.push(`Project context file (${path.basename(file)}):\n${content}`);
  }
  return parts.join('\n');
}

/**
 * Collects AGENTS.md / CLAUDE.md from the workspace root upward to the home
 * directory. For each filename the nearest occurrence wins; both filenames
 * may be present at different levels and are all included.
 */
export function findProjectContextFiles(cwd: string = process.cwd()): ProjectContextFile[] {
  const results: ProjectContextFile[] = [];
  const seen = new Set<string>();
  let dir = path.resolve(cwd);
  const home = os.homedir();

  while (dir.length > 0) {
    for (const name of PROJECT_CONTEXT_FILES) {
      if (seen.has(name)) continue;
      const candidate = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(candidate);
      } catch {
        continue; // not present at this level
      }
      if (!stat.isFile()) continue;
      let content = fs.readFileSync(candidate, 'utf-8');
      if (content.length > MAX_FILE_CHARS) {
        content = `${content.slice(0, MAX_FILE_CHARS)}\n… (truncated at ${MAX_FILE_CHARS} chars)`;
      }
      results.push({ file: candidate, content });
      seen.add(name);
    }
    if (dir === home || dir === path.parse(dir).root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return results;
}
