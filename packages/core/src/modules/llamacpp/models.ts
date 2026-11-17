import * as fs from 'node:fs';
import * as path from 'node:path';
import { modelsDir } from './paths.js';

export { modelsDir } from './paths.js';

export interface InstalledModel {
  file: string;
  path: string;
  sizeBytes: number;
}

/** Lists all .gguf model files installed in modelsDir(). */
export async function listInstalledModels(env: NodeJS.ProcessEnv = process.env): Promise<InstalledModel[]> {
  const dir = modelsDir(env);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: InstalledModel[] = [];

  for (const entry of entries) {
    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.gguf')) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          results.push({
            file: entry.name,
            path: fullPath,
            sizeBytes: stat.size,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  return results.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Imports a custom .gguf model file into the modelsDir, either by symlinking (default, zero copy)
 * or copying. This allows any user-downloaded .gguf model anywhere on disk to be registered.
 */
export async function importCustomModel(
  sourcePath: string,
  mode: 'symlink' | 'copy' = 'symlink',
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstalledModel> {
  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source model file not found: ${sourcePath}`);
  }
  const stat = fs.statSync(resolvedSource);
  if (!stat.isFile()) {
    throw new Error(`Source path is not a file: ${sourcePath}`);
  }
  if (!resolvedSource.toLowerCase().endsWith('.gguf')) {
    throw new Error(`File is not a .gguf model: ${sourcePath}`);
  }

  const dir = path.resolve(modelsDir(env));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileName = path.basename(resolvedSource);
  const targetPath = path.join(dir, fileName);

  // If already at the target location, nothing more to do
  if (resolvedSource === targetPath) {
    return { file: fileName, path: targetPath, sizeBytes: stat.size };
  }

  // If target already exists, remove it if it's a symlink or old file
  if (fs.existsSync(targetPath)) {
    try {
      const targetStat = fs.lstatSync(targetPath);
      if (targetStat.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
      } else if (targetStat.size === stat.size) {
        // Same file size already present
        return { file: fileName, path: targetPath, sizeBytes: stat.size };
      } else {
        fs.unlinkSync(targetPath);
      }
    } catch {
      /* ignore */
    }
  }

  if (mode === 'symlink') {
    try {
      fs.symlinkSync(resolvedSource, targetPath);
    } catch (symlinkErr) {
      // Fallback to copy if symlinks fail (e.g. cross-device or Windows permissions)
      try {
        fs.copyFileSync(resolvedSource, targetPath);
      } catch {
        throw new Error(
          `Failed to symlink or copy model to ${targetPath}: ${symlinkErr instanceof Error ? symlinkErr.message : String(symlinkErr)}`,
        );
      }
    }
  } else {
    fs.copyFileSync(resolvedSource, targetPath);
  }

  const finalStat = fs.statSync(targetPath);
  return {
    file: fileName,
    path: targetPath,
    sizeBytes: finalStat.size,
  };
}

/** Deletes a model file inside modelsDir(), refusing any path outside modelsDir(). */
export async function deleteInstalledModel(file: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const rootDir = path.resolve(modelsDir(env));
  const resolved = path.resolve(rootDir, file);

  // Path traversal guard
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error(`Path traversal denied: cannot delete file outside models directory (${file})`);
  }

  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
}
