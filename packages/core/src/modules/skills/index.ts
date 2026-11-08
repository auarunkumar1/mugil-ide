/**
 * Skills Harness
 * ==============
 * Discovers agent skills as `<dir>/<name>/SKILL.md` files with YAML-ish
 * frontmatter and exposes them to the runtime, CLI and Web UI.
 *
 * Discovery tiers (later tiers are lower priority — the first definition of a
 * name wins, so a workspace skill can override a global or builtin one):
 *   1. workspace — `.mugil/skills`, `.agents/skills`, `.claude/skills`
 *   2. global    — `~/.config/mugil-ide/skills` (shared across projects)
 *   3. builtin   — `<package>/skills` shipped with @mugil-ide/core
 *
 * Token strategy (Claude Code / Anthropic skills architecture):
 * - Only the skill *descriptions* are injected into the system prompt, so the
 *   model knows what is available at near-zero token cost.
 * - The full SKILL.md body is loaded lazily on demand via the `skill` tool.
 *
 * Credit: skill-file layout and lazy-loading pattern from Anthropic's Claude
 * Code skills standard — https://github.com/anthropics. See ATTRIBUTIONS.md
 * at the repository root for the full credit list.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Workspace-relative directories that may hold skills (priority order). */
export const SKILL_DIRS = ['.mugil/skills', '.agents/skills', '.claude/skills'];

/** Workspace config file holding per-workspace enable/disable state. */
const WORKSPACE_CONFIG = path.join('.mugil', 'config.json');

/** Per-skill cap so a runaway SKILL.md cannot blow the token budget. */
const MAX_SKILL_CHARS = 60_000;

export type SkillSource = 'workspace' | 'global' | 'builtin';

export interface SkillMetadata {
  /** Skill id — the directory name (used by the `skill` tool). */
  name: string;
  /** One-line description from frontmatter (injected into the system prompt). */
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  /** Phrases that activate the skill automatically for a matching prompt. */
  triggers?: string[];
  /** Tools this skill expects to use (advisory, shown in the UI). */
  tools?: string[];
  /** False when the user disabled it in `.mugil/config.json`. */
  enabled: boolean;
  source: SkillSource;
  /** Absolute path to SKILL.md. */
  file: string;
  /** A `scripts/` directory sits next to SKILL.md. */
  hasScripts: boolean;
  /** A `references/` directory sits next to SKILL.md. */
  hasReferences: boolean;
}

/** Back-compat alias: the runtime only ever needed these three fields. */
export type SkillInfo = Pick<SkillMetadata, 'name' | 'description' | 'file'>;

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  triggers?: string[];
  tools?: string[];
}

/** Splits `a, b` / `[a, b]` / `a` into a trimmed list. */
function parseList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Parses the leading `---\nkey: value\n---` block of a SKILL.md file. */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = {};
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return out;
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('- ')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
    else if (key === 'version') out.version = value;
    else if (key === 'author') out.author = value;
    else if (key === 'tags') out.tags = parseList(value);
    else if (key === 'triggers') out.triggers = parseList(value);
    else if (key === 'tools') out.tools = parseList(value);
  }
  return out;
}

/** Global (cross-project) skills directory. */
export function globalSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUGIL_IDE_SKILLS_DIR || path.join(os.homedir(), '.config', 'mugil-ide', 'skills');
}

/** Skills bundled with @mugil-ide/core (absent in a source-only checkout is fine). */
export function builtinSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MUGIL_IDE_BUILTIN_SKILLS_DIR) return env.MUGIL_IDE_BUILTIN_SKILLS_DIR;
  // `__dirname` works from both the CJS build (dist/modules/skills) and the TS
  // sources (src/modules/skills): three levels up is the package root either way.
  return path.resolve(__dirname, '../../../skills');
}

/** Reads the disabled-skill list from `.mugil/config.json` (tolerates garbage). */
function readDisabled(cwd: string): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, WORKSPACE_CONFIG), 'utf-8')) as {
      skills?: { disabled?: unknown };
    };
    const list = raw.skills?.disabled;
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Persists the disabled-skill list, preserving other config keys. */
function writeDisabled(cwd: string, disabled: Set<string>): void {
  const file = path.join(cwd, WORKSPACE_CONFIG);
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    // Missing or invalid: start from an empty object.
  }
  const skills = (config.skills ?? {}) as Record<string, unknown>;
  config.skills = { ...skills, disabled: [...disabled].sort() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

interface Tier {
  dir: string;
  source: SkillSource;
}

function tiers(cwd: string): Tier[] {
  return [
    ...SKILL_DIRS.map((dirName) => ({ dir: path.join(cwd, dirName), source: 'workspace' as const })),
    { dir: globalSkillsDir(), source: 'global' as const },
    { dir: builtinSkillsDir(), source: 'builtin' as const },
  ];
}

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scans every discovery tier for `<name>/SKILL.md` files. A name defined in a
 * higher tier shadows the same name in a lower one.
 */
export function discoverSkills(cwd: string = process.cwd()): SkillMetadata[] {
  const found: SkillMetadata[] = [];
  const seen = new Set<string>();
  const disabled = readDisabled(cwd);
  for (const tier of tiers(cwd)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(tier.dir, { withFileTypes: true });
    } catch {
      continue; // tier absent
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(tier.dir, entry.name);
      const file = path.join(dir, 'SKILL.md');
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // no SKILL.md
      }
      const front = parseSkillFrontmatter(text);
      const name = front.name || entry.name;
      if (seen.has(name)) continue;
      seen.add(name);
      found.push({
        name,
        description: front.description || firstMeaningfulLine(text),
        ...(front.version ? { version: front.version } : {}),
        ...(front.author ? { author: front.author } : {}),
        ...(front.tags ? { tags: front.tags } : {}),
        ...(front.triggers ? { triggers: front.triggers } : {}),
        ...(front.tools ? { tools: front.tools } : {}),
        enabled: !disabled.has(name),
        source: tier.source,
        file,
        hasScripts: isDir(path.join(dir, 'scripts')),
        hasReferences: isDir(path.join(dir, 'references')),
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Loads a skill's full SKILL.md body by name (capped); null when absent. */
export function loadSkill(cwd: string, name: string): string | null {
  const skill = discoverSkills(cwd).find((s) => s.name === name);
  if (!skill) return null;
  let content = fs.readFileSync(skill.file, 'utf-8');
  if (content.length > MAX_SKILL_CHARS) {
    content = `${content.slice(0, MAX_SKILL_CHARS)}\n… (truncated at ${MAX_SKILL_CHARS} chars)`;
  }
  return content;
}

/** Files a skill bundles next to its SKILL.md (helper scripts + reference docs). */
export function listSkillAssets(cwd: string, name: string): { scripts: string[]; references: string[] } {
  const skill = discoverSkills(cwd).find((s) => s.name === name);
  if (!skill) return { scripts: [], references: [] };
  const dir = path.dirname(skill.file);
  const read = (sub: string): string[] => {
    try {
      return fs
        .readdirSync(path.join(dir, sub), { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  };
  return { scripts: read('scripts'), references: read('references') };
}

/** Enables/disables a skill for a workspace (persisted in `.mugil/config.json`). */
export function setSkillEnabled(cwd: string, name: string, enabled: boolean): boolean {
  if (!discoverSkills(cwd).some((s) => s.name === name)) return false;
  const disabled = readDisabled(cwd);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  writeDisabled(cwd, disabled);
  return true;
}

/**
 * Scaffolds `.mugil/skills/<name>/SKILL.md` (and empty scripts/references
 * dirs) and returns the created file path. Throws if the name is unsafe or the
 * skill already exists.
 */
export function createSkill(
  cwd: string,
  name: string,
  description = 'Describe what this skill does and when to use it.',
  options: { source?: SkillSource; version?: string; author?: string; tags?: string[]; triggers?: string[] } = {},
): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('skill name must be lowercase letters, digits, ".", "_" or "-" (max 64 chars)');
  }
  const source = options.source ?? 'workspace';
  const base =
    source === 'global'
      ? globalSkillsDir()
      : SKILL_DIRS.map((d) => path.join(cwd, d)).find((dir) => isDir(dir)) ?? path.join(cwd, SKILL_DIRS[0]!);
  const dir = path.join(base, name);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`skill "${name}" already exists`);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `version: ${options.version ?? '0.1.0'}`,
    ...(options.author ? [`author: ${options.author}`] : []),
    ...(options.tags?.length ? [`tags: ${options.tags.join(', ')}`] : []),
    ...(options.triggers?.length ? [`triggers: ${options.triggers.join(', ')}`] : []),
    '---',
    '',
    `# ${name}`,
    '',
    '## When to use',
    '',
    description,
    '',
    '## Steps',
    '',
    '1. ',
    '',
  ].join('\n');
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, frontmatter, 'utf-8');
  return file;
}

/**
 * The low-token system-prompt block listing available skills
 * ("Available skills:\n- name — description"). Empty when none exist.
 */
export function skillsContextBlock(cwd: string = process.cwd()): string {
  const skills = discoverSkills(cwd).filter((s) => s.enabled);
  if (skills.length === 0) return '';
  const lines = [
    'Available skills (load the full instructions with the skill tool):',
    ...skills.map((s) => `- ${s.name} — ${s.description}`),
  ];
  return lines.join('\n');
}

/**
 * Skills whose `triggers` appear in `prompt`. Used to inject instructions for
 * the obvious cases so the model does not have to spend a tool call first.
 */
export function matchSkillTriggers(cwd: string, prompt: string): SkillMetadata[] {
  const haystack = prompt.toLowerCase();
  return discoverSkills(cwd).filter(
    (skill) =>
      skill.enabled &&
      (skill.triggers ?? []).some((trigger) => trigger.length >= 3 && haystack.includes(trigger.toLowerCase())),
  );
}

/** Prompt block for the skills matched by `matchSkillTriggers`. */
export function triggeredSkillsBlock(cwd: string, prompt: string): string {
  const matches = matchSkillTriggers(cwd, prompt);
  if (matches.length === 0) return '';
  const bodies = matches
    .map((skill) => {
      const body = loadSkill(cwd, skill.name) ?? '';
      return `### Skill: ${skill.name}\n${body}`;
    })
    .join('\n\n');
  return `The following skills matched this request. Follow their instructions.\n\n${bodies}`;
}

function firstMeaningfulLine(text: string): string {
  const body = text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length > 0 && !line.startsWith('#') && !line.startsWith('<!--')) {
      return line.slice(0, 140);
    }
  }
  return 'No description provided.';
}
