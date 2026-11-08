/**
 * Skills Gallery & Credits Types
 * ==============================
 * Data structures for the curated open-source skills gallery, installer engine,
 * and project attributions manifest.
 */

export type SkillCategory =
  | 'Architecture'
  | 'Testing'
  | 'Security'
  | 'Refactoring'
  | 'DevOps'
  | 'Git & Workflow'
  | 'Performance'
  | 'Business Logic';

export interface GallerySkill {
  /** Unique slug identifier (lowercase, e.g. `playwright-e2e`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description shown in catalogs and prompt context. */
  description: string;
  /** Categorical domain. */
  category: SkillCategory;
  /** Original creator or maintainer organization. */
  author: string;
  /** Canonical upstream source or documentation link. */
  upstreamUrl: string;
  /** SPDX license identifier (e.g. `MIT`, `Apache-2.0`). */
  license: string;
  /** Semantic version string. */
  version: string;
  /** Keyword tags for filtering and discovery. */
  tags: string[];
  /** Phrases that trigger auto-injection into prompts. */
  triggers: string[];
  /** Standard agent tools this skill commonly utilizes. */
  tools?: string[];
  /** Full markdown content for the SKILL.md template. */
  content: string;
  /** Whether this skill is currently installed in the workspace/global library. */
  installed?: boolean;
  /** Tier in which this skill was found if installed. */
  installedTarget?: 'workspace' | 'global' | 'builtin';
}

export type SkillTarget = 'workspace' | 'global';

export type InstallSkillSourceType = 'gallery' | 'git' | 'url' | 'path';

export interface InstallSkillOptions {
  /** Installation tier: `workspace` (.mugil/skills) or `global` (~/.config/mugil-ide/skills). Defaults to `workspace`. */
  target?: SkillTarget;
  /** Whether to replace an existing skill directory of the same name. Defaults to false. */
  overwrite?: boolean;
  /** Custom skill name override. */
  name?: string;
  /** Optional HTTP/fetch function for testing. */
  fetchFn?: typeof fetch;
  /** Optional DNS resolver for testing the SSRF guard. */
  dnsLookupFn?: (hostname: string) => Promise<{ address: string; family?: number }>;
}

export interface InstallResult {
  ok: boolean;
  name: string;
  target: SkillTarget;
  dir: string;
  file: string;
  source: InstallSkillSourceType;
  message: string;
}

export interface CreditRecord {
  name: string;
  category: 'skill' | 'core-module' | 'library';
  author: string;
  upstreamUrl: string;
  license: string;
  concept: string;
  installed?: boolean;
}

export interface CreditsManifest {
  skills: CreditRecord[];
  coreModules: CreditRecord[];
  libraries: CreditRecord[];
}
