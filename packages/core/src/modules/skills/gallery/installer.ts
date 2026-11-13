/**
 * Universal Skill Installer
 * =========================
 * Installs skills from the curated gallery, Git/GitHub repositories, direct URLs,
 * and local directories with strict lexical sandboxing and validation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInsideWorkspace } from '../../tools/paths.js';
import { guardedFetch } from '../../security/restrictedNet.js';
import { globalSkillsDir, parseSkillFrontmatter } from '../index.js';
import { VERSION } from '../../../branding.js';
import { CURATED_GALLERY_SKILLS } from './catalog.js';
import type { InstallResult, InstallSkillOptions, SkillTarget } from './types.js';

/** Directory names never copied out of a local skill folder. */
const COPY_DENYLIST = new Set(['.git', 'node_modules', '.env', '.env.local', '.env.production']);
/** Files larger than this are skipped when importing a local skill folder. */
const MAX_COPY_FILE_BYTES = 1024 * 1024;

export function validateSkillName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(trimmed)) {
    throw new Error(
      `invalid skill name "${name}": must be lowercase alphanumeric, ".", "_" or "-" (max 64 chars)`,
    );
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`path traversal characters are forbidden in skill name: "${name}"`);
  }
  return trimmed;
}

export function resolveSkillTargetDir(
  cwd: string,
  name: string,
  target: SkillTarget = 'workspace',
): string {
  const validName = validateSkillName(name);
  if (target === 'workspace') {
    // resolveInsideWorkspace verifies physical boundary containment. It runs
    // before any mkdir so a rejected path cannot create directories first (and
    // so uninstalling a missing skill has no side effects).
    const res = resolveInsideWorkspace(cwd, path.join('.mugil', 'skills', validName));
    if (res.error) throw new Error(res.error);
    return res.target;
  } else {
    const parentDir = globalSkillsDir();
    const targetDir = path.resolve(parentDir, validName);
    const resolvedParent = path.resolve(parentDir);
    if (!targetDir.startsWith(resolvedParent)) {
      throw new Error(`target directory escapes global skills boundary: ${targetDir}`);
    }
    return targetDir;
  }
}

/** Installs a curated skill from the built-in gallery catalog. */
export async function installFromGallery(
  cwd: string,
  skillId: string,
  options: InstallSkillOptions = {},
): Promise<InstallResult> {
  const item = CURATED_GALLERY_SKILLS.find(
    (s) =>
      s.id.toLowerCase() === skillId.trim().toLowerCase() ||
      s.name.toLowerCase() === skillId.trim().toLowerCase(),
  );
  if (!item) {
    const available = CURATED_GALLERY_SKILLS.map((s) => s.id).join(', ');
    throw new Error(`unknown gallery skill "${skillId}". Available in catalog: ${available}`);
  }

  const name = options.name ? validateSkillName(options.name) : item.id;
  const target = options.target ?? 'workspace';
  const dir = resolveSkillTargetDir(cwd, name, target);

  if (fs.existsSync(dir) && !options.overwrite) {
    throw new Error(
      `skill "${name}" is already installed at ${dir}. Use overwrite: true to replace.`,
    );
  }

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });

  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, item.content.trim() + '\n', 'utf-8');

  return {
    ok: true,
    name,
    target,
    dir,
    file,
    source: 'gallery',
    message: `Skill "${name}" successfully installed from gallery to ${target} tier.`,
  };
}

/** Installs a skill from raw markdown content. */
export function installFromRawContent(
  cwd: string,
  name: string,
  content: string,
  options: InstallSkillOptions = {},
): InstallResult {
  const validName = validateSkillName(name);
  const target = options.target ?? 'workspace';
  const dir = resolveSkillTargetDir(cwd, validName, target);

  if (fs.existsSync(dir) && !options.overwrite) {
    throw new Error(
      `skill "${validName}" is already installed at ${dir}. Use overwrite: true to replace.`,
    );
  }

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });

  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, content.trim() + '\n', 'utf-8');

  return {
    ok: true,
    name: validName,
    target,
    dir,
    file,
    source: 'url',
    message: `Skill "${validName}" successfully created in ${target} tier.`,
  };
}

/** Parses a GitHub tree/blob or raw URL into a fetchable raw SKILL.md URL. */
export function resolveGitHubRawUrl(urlStr: string): { rawUrl: string; inferredName: string } {
  const parsed = new URL(urlStr);
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  // Example: github.com/owner/repo/tree/branch/path/to/skill
  //          github.com/owner/repo/blob/branch/path/to/SKILL.md
  if (
    parsed.hostname === 'github.com' &&
    pathParts.length >= 4 &&
    (pathParts[2] === 'tree' || pathParts[2] === 'blob')
  ) {
    const owner = pathParts[0]!;
    const repo = pathParts[1]!;
    const branch = pathParts[3]!;
    const subpath = pathParts.slice(4).join('/');
    const last = pathParts[pathParts.length - 1]!;
    // A blob URL ends in SKILL.md, so the skill name is the parent directory.
    const inferredName =
      last.toLowerCase() === 'skill.md'
        ? (pathParts[pathParts.length - 2] ?? repo)
        : last.replace(/\.md$/i, '') || repo;
    const skillPath = subpath.endsWith('SKILL.md')
      ? subpath
      : `${subpath}/SKILL.md`.replace(/^\//, '');
    return {
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}`,
      inferredName,
    };
  }

  // Example: raw.githubusercontent.com/owner/repo/branch/path/SKILL.md
  if (parsed.hostname === 'raw.githubusercontent.com') {
    const inferredName = pathParts.length > 3 ? pathParts[pathParts.length - 2]! : 'custom-skill';
    return { rawUrl: urlStr, inferredName };
  }

  // Fallback to the direct URL
  const lastSegment = pathParts[pathParts.length - 1] ?? 'custom-skill';
  const inferredName = lastSegment.replace(/\.md$/i, '');
  return { rawUrl: urlStr, inferredName };
}

/** Installs a skill from an HTTP(S) raw markdown URL. */
export async function installFromUrl(
  cwd: string,
  urlStr: string,
  options: InstallSkillOptions = {},
): Promise<InstallResult> {
  const { rawUrl, inferredName } = resolveGitHubRawUrl(urlStr);
  const fetcher = options.fetchFn ?? fetch;

  // guardedFetch blocks loopback/link-local/metadata hosts and re-checks every
  // redirect hop, so a pasted URL cannot reach the instance metadata service.
  const res = await guardedFetch(rawUrl, {
    fetchFn: fetcher,
    ...(options.dnsLookupFn ? { dnsLookupFn: options.dnsLookupFn } : {}),
    headers: { 'User-Agent': `Mugil-IDE-Skill-Installer/${VERSION}` },
    timeoutMs: 15_000,
  });

  if (!res.ok) {
    throw new Error(`failed to fetch skill from ${rawUrl}: HTTP ${res.status} ${res.statusText}`);
  }

  const content = await res.text();
  assertSkillMarkdown(content, rawUrl);
  const front = parseSkillFrontmatter(content);
  const chosenName = options.name ?? front.name ?? inferredName;

  return installFromRawContent(cwd, chosenName, content, options);
}

/**
 * Rejects bodies that are not a SKILL.md — most often GitHub's HTML page for a
 * `/blob/` or `/tree/` URL that could not be rewritten to raw.githubusercontent.
 */
function assertSkillMarkdown(content: string, source: string): void {
  const head = content.trimStart();
  if (!head.startsWith('---') && !head.startsWith('#')) {
    throw new Error(
      `fetched content from ${source} does not look like a SKILL.md (expected frontmatter or a markdown heading).`,
    );
  }
}

/** Must be a file that can safely be copied into a skill directory. */
function copyableEntry(entry: fs.Dirent): boolean {
  if (COPY_DENYLIST.has(entry.name)) return false;
  return entry.isDirectory() || entry.isFile() || entry.isSymbolicLink();
}

/**
 * Copies a local skill folder without dragging in VCS data, dependency trees,
 * dotenv files or oversized blobs. Symlinks are skipped: following them would
 * let a source folder exfiltrate arbitrary files into a git-tracked path.
 */
function copySkillDir(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!copyableEntry(entry) || entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copySkillDir(from, to);
      continue;
    }
    try {
      if (fs.statSync(from).size > MAX_COPY_FILE_BYTES) continue;
      fs.copyFileSync(from, to);
    } catch {
      // Unreadable file: skip rather than fail the whole install.
    }
  }
}

/** Installs a skill by copying from an existing local folder. */
export function installFromPath(
  cwd: string,
  sourcePath: string,
  options: InstallSkillOptions = {},
): InstallResult {
  const absSource = path.resolve(cwd, sourcePath);
  if (!fs.existsSync(absSource) || !fs.statSync(absSource).isDirectory()) {
    throw new Error(`source directory does not exist or is not a directory: ${absSource}`);
  }

  const skillFile = path.join(absSource, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`source directory does not contain a SKILL.md file: ${absSource}`);
  }

  const content = fs.readFileSync(skillFile, 'utf-8');
  assertSkillMarkdown(content, skillFile);
  const front = parseSkillFrontmatter(content);
  const name = options.name ?? front.name ?? path.basename(absSource);
  const validName = validateSkillName(name);
  const target = options.target ?? 'workspace';
  const targetDir = resolveSkillTargetDir(cwd, validName, target);

  if (fs.existsSync(targetDir) && !options.overwrite) {
    throw new Error(
      `skill "${validName}" is already installed at ${targetDir}. Use overwrite: true to replace.`,
    );
  }

  // Filtered recursive copy (no VCS metadata, dependency trees, dotenv files).
  copySkillDir(absSource, targetDir);

  return {
    ok: true,
    name: validName,
    target,
    dir: targetDir,
    file: path.join(targetDir, 'SKILL.md'),
    source: 'path',
    message: `Skill "${validName}" successfully imported from local path into ${target} tier.`,
  };
}

/** Uninstalls an installed skill from the given tier. */
export function uninstallSkill(
  cwd: string,
  skillName: string,
  options: { target?: SkillTarget } = {},
): boolean {
  const validName = validateSkillName(skillName);
  const target = options.target ?? 'workspace';
  const dir = resolveSkillTargetDir(cwd, validName, target);

  if (!fs.existsSync(dir)) {
    return false;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
