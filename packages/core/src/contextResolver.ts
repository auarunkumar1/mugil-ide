import fs from 'node:fs';
import path from 'node:path';

export interface ResolveContextResult {
  /** Prompt with file contexts appended or integrated. */
  resolvedPrompt: string;
  /** List of files that were successfully attached. */
  attachedFiles: string[];
  /** Warnings for files that could not be found or read. */
  warnings: string[];
}

const MAX_FILE_SIZE_BYTES = 250_000; // 250 KB per file

/**
 * Scans a user prompt for `@filepath` or `@"path with spaces"` mentions,
 * reads the local files from the filesystem, and appends their content
 * formatted with markdown blocks to provide grounding context for the LLM.
 */
export function resolveFileContext(prompt: string, cwd: string = process.cwd()): ResolveContextResult {
  const attachedFiles: string[] = [];
  const warnings: string[] = [];
  const fileContents: string[] = [];

  // Match @filename or @"file path with spaces"
  const regex = /(?:^|\s)@(?:"([^"]+)"|([^\s]+))/g;
  let match: RegExpExecArray | null;

  const foundPaths = new Set<string>();
  while ((match = regex.exec(prompt)) !== null) {
    const rawPath = match[1] ?? match[2];
    if (rawPath && !rawPath.startsWith('@') && rawPath.length > 1) {
      foundPaths.add(rawPath);
    }
  }

  for (const raw of foundPaths) {
    // Avoid false positives like email addresses or common decorators
    if (raw.includes('@') || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(raw)) {
      continue;
    }

    try {
      const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) {
          if (stat.size > MAX_FILE_SIZE_BYTES) {
            warnings.push(`@${raw} is too large (>250KB), reading first 250KB.`);
          }
          const buffer = fs.readFileSync(resolved);
          const text = buffer.slice(0, MAX_FILE_SIZE_BYTES).toString('utf-8');
          const ext = path.extname(raw).replace(/^\./, '') || 'text';
          const relPath = path.relative(cwd, resolved);

          fileContents.push(
            `\n\`\`\`${ext} [File: ${relPath}]\n${text}\n\`\`\``
          );
          attachedFiles.push(relPath);
        } else if (stat.isDirectory()) {
          // List directory files
          const files = fs.readdirSync(resolved);
          const relPath = path.relative(cwd, resolved) || '.';
          fileContents.push(
            `\n[Directory: ${relPath}]\nFiles: ${files.slice(0, 50).join(', ')}${files.length > 50 ? '…' : ''}`
          );
          attachedFiles.push(relPath);
        }
      } else {
        warnings.push(`File not found: @${raw}`);
      }
    } catch (err) {
      warnings.push(`Could not read @${raw}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fileContents.length === 0) {
    return { resolvedPrompt: prompt, attachedFiles, warnings };
  }

  const contextBlock = `\n\n--- Context from attached local files ---\n${fileContents.join('\n')}\n------------------------------------------`;
  return {
    resolvedPrompt: `${prompt}${contextBlock}`,
    attachedFiles,
    warnings,
  };
}
