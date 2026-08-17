/**
 * Skills Harness
 * ==============
 * Discovers agent skills from the standard locations (`.agents/skills/` and
 * `.claude/skills/`, each skill being a `<name>/SKILL.md` with YAML-ish
 * frontmatter: `name`, `description`) and exposes them to the runtime.
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
import * as path from 'node:path';

/** Directories (relative to the workspace root) that may hold skills. */
export const SKILL_DIRS = ['.agents/skills', '.claude/skills'];

/** Per-skill cap so a runaway SKILL.md cannot blow the token budget. */
const MAX_SKILL_CHARS = 60_000;

export interface SkillInfo {
  /** Skill id — the directory name (used by the `skill` tool). */
  name: string;
  /** One-line description from frontmatter (injected into the system prompt). */
  description: string;
  /** Absolute path to SKILL.md. */
  file: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/** Parses the leading `---\nkey: value\n---` block of a SKILL.md file. */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = {};
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return out;
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out;
}

/** Scans the skill directories under `cwd` for `<name>/SKILL.md` files. */
export function discoverSkills(cwd: string = process.cwd()): SkillInfo[] {
  const found: SkillInfo[] = [];
  for (const dirName of SKILL_DIRS) {
    const dir = path.join(cwd, dirName);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // dir absent
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // no SKILL.md
      }
      const front = parseSkillFrontmatter(text);
      found.push({
        name: front.name || entry.name,
        description: front.description || firstMeaningfulLine(text),
        file,
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Loads a skill's full SKILL.md body by name (capped); null when absent. */
export function loadSkill(cwd: string, name: string): string | null {
  const skills = discoverSkills(cwd);
  const skill = skills.find((s) => s.name === name);
  if (!skill) return null;
  let content = fs.readFileSync(skill.file, 'utf-8');
  if (content.length > MAX_SKILL_CHARS) {
    content = `${content.slice(0, MAX_SKILL_CHARS)}\n… (truncated at ${MAX_SKILL_CHARS} chars)`;
  }
  return content;
}

/**
 * The low-token system-prompt block listing available skills
 * ("Available skills:\n- name — description"). Empty when none exist.
 */
export function skillsContextBlock(cwd: string = process.cwd()): string {
  const skills = discoverSkills(cwd);
  if (skills.length === 0) return '';
  const lines = ['Available skills (load the full instructions with the skill tool):', ...skills.map((s) => `- ${s.name} — ${s.description}`)];
  return lines.join('\n');
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
