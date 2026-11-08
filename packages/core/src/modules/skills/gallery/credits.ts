/**
 * Open-Source Credits & Attributions Aggregator
 * ==============================================
 * Collects and unifies attributions across curated skills, installed agent skills,
 * core engine modules (from ATTRIBUTIONS.md), and core infrastructure libraries.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverSkills } from '../index.js';
import { CURATED_GALLERY_SKILLS } from './catalog.js';
import type { CreditRecord, CreditsManifest } from './types.js';

/** Fallback core module attributions matching ATTRIBUTIONS.md. */
const DEFAULT_CORE_MODULE_CREDITS: CreditRecord[] = [
  {
    name: 'OpenCode — Agent & Tool Patterns',
    category: 'core-module',
    author: 'OpenCode (sst/opencode)',
    upstreamUrl: 'https://github.com/sst/opencode',
    license: 'MIT',
    concept:
      'Architectural patterns for coding agents: multi-turn loop, apply_patch, mid-task question tool, todowrite/todoread.',
  },
  {
    name: 'Caveman',
    category: 'core-module',
    author: 'Julius Brussee',
    upstreamUrl: 'https://github.com/JuliusBrussee/caveman',
    license: 'Skill: MIT; proxy/engine: BSL-1.1',
    concept: 'Terse, filler-free prompt engineering cutting ~65% of output tokens.',
  },
  {
    name: 'RTK — Reduced Token Kernel',
    category: 'core-module',
    author: 'rtk-ai / Rust Token Killer',
    upstreamUrl: 'https://github.com/rtk-ai/rtk',
    license: 'MIT',
    concept:
      'Compressing redundant tool/command output (git status/diff/log, test runs) for 60-90% token reduction.',
  },
  {
    name: 'Ponytail',
    category: 'core-module',
    author: 'Dietrich Gebert',
    upstreamUrl: 'https://github.com/DietrichGebert/ponytail',
    license: 'MIT',
    concept:
      'Output minimization & YAGNI ladder: write the smallest solution that passes, saving ~54% output code.',
  },
  {
    name: 'Signature Remover',
    category: 'core-module',
    author: 'Anthropic, OpenAI & Community de-AI tooling',
    upstreamUrl: 'https://github.com/conorbronsdon/avoid-ai-writing',
    license: 'MIT',
    concept:
      'Stripping identity preambles and AI-attribution headers/comments from generated code.',
  },
  {
    name: 'Watermark Remover',
    category: 'core-module',
    author: 'Guillaume Meyer',
    upstreamUrl: 'https://github.com/guillaumemeyer/watermarks-remover',
    license: 'MIT',
    concept:
      'Stripping invisible Unicode AI provenance watermarks (zero-width chars, bidi, tag chars, exotic spaces).',
  },
  {
    name: 'Codegraph',
    category: 'core-module',
    author: 'Colby McHenry',
    upstreamUrl: 'https://github.com/colbymchenry/codegraph',
    license: 'MIT',
    concept: 'Pre-built symbol and call-graph index of codebase for surgical context retrieval.',
  },
  {
    name: 'Tool Loop & MCP Client',
    category: 'core-module',
    author: 'Model Context Protocol (Anthropic) & OpenCode',
    upstreamUrl: 'https://modelcontextprotocol.io',
    license: 'MIT',
    concept:
      'Bounded multi-turn tool execution, MCP server namespacing, and lazy schema gateway pruning.',
  },
  {
    name: 'xterm.js',
    category: 'core-module',
    author: 'xterm.js Project & Contributors',
    upstreamUrl: 'https://github.com/xtermjs/xterm.js',
    license: 'MIT',
    concept:
      'Browser-based terminal emulator runtime and fit/web-links add-ons vendored for offline execution.',
  },
  {
    name: 'Tokenizer',
    category: 'core-module',
    author: 'OpenAI tiktoken',
    upstreamUrl: 'https://github.com/openai/tiktoken',
    license: 'MIT',
    concept: 'Fast byte-pair-encoding BPE token counting for context budget sizing.',
  },
];

const CORE_LIBRARIES: CreditRecord[] = [
  {
    name: '@modelcontextprotocol/sdk',
    category: 'library',
    author: 'Anthropic / MCP Working Group',
    upstreamUrl: 'https://github.com/modelcontextprotocol/typescript-sdk',
    license: 'MIT',
    concept: 'Official TypeScript SDK for Model Context Protocol client and server connectivity.',
  },
  {
    name: 'diff',
    category: 'library',
    author: 'Kevin Decker',
    upstreamUrl: 'https://github.com/kpdecker/jsdiff',
    license: 'BSD-3-Clause',
    concept: 'Unified diff generation, hunk parsing, and reverse-patch application for staging.',
  },
  {
    name: 'zod',
    category: 'library',
    author: 'Colin McDonnell',
    upstreamUrl: 'https://github.com/colinhacks/zod',
    license: 'MIT',
    concept: 'TypeScript-first schema validation with static type inference.',
  },
];

/** Parses ATTRIBUTIONS.md rows if present. */
export function parseAttributionsMarkdown(content: string): CreditRecord[] {
  const records: CreditRecord[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('| Module |')) continue;
    const parts = line
      .split('|')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length >= 5) {
      const name = parts[0]!.replace(/\*\*/g, '').trim();
      const concept = parts[1]!.trim();
      const author = parts[2]!.trim();
      const upstreamUrl = parts[3]!.split('·')[0]!.trim();
      const license = parts[4]!.trim();
      records.push({
        name,
        category: 'core-module',
        author,
        upstreamUrl,
        license,
        concept,
      });
    }
  }
  return records.length > 0 ? records : DEFAULT_CORE_MODULE_CREDITS;
}

/** Aggregates full credits manifest for the current workspace. */
export function getCredits(cwd: string = process.cwd()): CreditsManifest {
  // 1. Core modules from ATTRIBUTIONS.md if found, otherwise built-in list
  let coreModules = DEFAULT_CORE_MODULE_CREDITS;
  const attributionsPath = path.resolve(cwd, 'ATTRIBUTIONS.md');
  if (fs.existsSync(attributionsPath)) {
    try {
      const text = fs.readFileSync(attributionsPath, 'utf-8');
      coreModules = parseAttributionsMarkdown(text);
    } catch {
      // Fallback to default
    }
  }

  // 2. Discover installed skills
  const installed = discoverSkills(cwd);
  const installedMap = new Map(installed.map((s) => [s.name, s]));

  // 3. Unify skills from gallery and installed list
  const skillCredits: CreditRecord[] = [];
  const seenSkillNames = new Set<string>();

  // Add gallery skills
  for (const item of CURATED_GALLERY_SKILLS) {
    seenSkillNames.add(item.id);
    const isInstalled = installedMap.has(item.id);
    skillCredits.push({
      name: item.name,
      category: 'skill',
      author: item.author,
      upstreamUrl: item.upstreamUrl,
      license: item.license,
      concept: item.description,
      installed: isInstalled,
    });
  }

  // Add any custom installed skills that aren't in the curated gallery
  for (const s of installed) {
    if (!seenSkillNames.has(s.name)) {
      seenSkillNames.add(s.name);
      skillCredits.push({
        name: s.name,
        category: 'skill',
        author: s.author || 'Custom / User Installed',
        upstreamUrl: (s as unknown as { upstream?: string }).upstream || 'Workspace Local',
        license: (s as unknown as { license?: string }).license || 'Proprietary / Unspecified',
        concept: s.description,
        installed: true,
      });
    }
  }

  return {
    skills: skillCredits,
    coreModules,
    libraries: CORE_LIBRARIES,
  };
}
