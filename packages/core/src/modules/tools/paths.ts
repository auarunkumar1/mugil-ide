/**
 * Workspace path containment
 * ==========================
 * One implementation of "this path must stay inside the workspace root",
 * shared by the agent tools and the HTTP routes so they cannot drift apart.
 * Rejects both lexical escapes (`../`) and symlink/junction escapes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Resolves a tool-supplied path and enforces containment inside the root. */
export function resolveInsideWorkspace(
  root: string,
  rawPath: string,
): { target: string; error?: string } {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, rawPath);
  const rel = path.relative(normalizedRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      target,
      error: `Error: path "${rawPath}" is outside the workspace root (${normalizedRoot}). Paths must stay inside the workspace.`,
    };
  }
  // Realpath containment check: prevents symlink/junction escapes.
  // If target does not exist yet (e.g. creating a new file in a symlinked folder),
  // probe the closest existing ancestor directory.
  try {
    const realRoot = fs.existsSync(normalizedRoot)
      ? fs.realpathSync(normalizedRoot)
      : normalizedRoot;
    let probe = target;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      const realRel = path.relative(realRoot, realProbe);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return {
          target,
          error: `Error: path "${rawPath}" resolves outside workspace via symlink (${realProbe}). Paths must stay inside the workspace.`,
        };
      }
    }
  } catch {
    // If realpath resolution fails, the lexical check above remains enforced.
  }
  return { target };
}
