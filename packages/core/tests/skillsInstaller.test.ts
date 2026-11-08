import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CURATED_GALLERY_SKILLS,
  discoverSkills,
  installFromGallery,
  installFromPath,
  installFromRawContent,
  installFromUrl,
  uninstallSkill,
  validateSkillName,
} from '../src/index.js';

describe('validateSkillName', () => {
  it('accepts valid lowercase names', () => {
    expect(validateSkillName('playwright-e2e')).toBe('playwright-e2e');
    expect(validateSkillName('system_architect')).toBe('system_architect');
    expect(validateSkillName('custom.skill.1')).toBe('custom.skill.1');
  });

  it('rejects path traversal and invalid characters', () => {
    expect(() => validateSkillName('../escaped')).toThrow();
    expect(() => validateSkillName('foo/bar')).toThrow();
    expect(() => validateSkillName('foo\\bar')).toThrow();
    expect(() => validateSkillName('Skill Name With Spaces')).toThrow();
    expect(() => validateSkillName('')).toThrow();
  });
});

describe('Skills Gallery & Installer', () => {
  let root: string;
  let globalDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-install-ws-'));
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-install-global-'));
    process.env.MUGIL_IDE_SKILLS_DIR = globalDir;
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    if (fs.existsSync(globalDir)) fs.rmSync(globalDir, { recursive: true, force: true });
    delete process.env.MUGIL_IDE_SKILLS_DIR;
  });

  it('catalog exposes curated open-source skills with full metadata', () => {
    expect(CURATED_GALLERY_SKILLS.length).toBeGreaterThanOrEqual(14);
    for (const skill of CURATED_GALLERY_SKILLS) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.author).toBeTruthy();
      expect(skill.upstreamUrl).toMatch(/^https?:\/\//);
      expect(skill.license).toBeTruthy();
      expect(skill.category).toBeTruthy();
      expect(skill.content).toContain('---');
    }
  });

  it('installs a skill from gallery into workspace tier (.mugil/skills)', async () => {
    const res = await installFromGallery(root, 'playwright-e2e', { target: 'workspace' });
    expect(res.ok).toBe(true);
    expect(res.name).toBe('playwright-e2e');
    expect(res.target).toBe('workspace');
    expect(fs.existsSync(res.file)).toBe(true);
    expect(fs.existsSync(path.join(res.dir, 'scripts'))).toBe(true);

    const discovered = discoverSkills(root);
    const found = discovered.find((s) => s.name === 'playwright-e2e');
    expect(found).toBeDefined();
    expect(found!.source).toBe('workspace');
    expect(found!.upstream).toBe('https://github.com/microsoft/playwright');
  });

  it('installs a skill from gallery into global tier', async () => {
    const res = await installFromGallery(root, 'owasp-guard', { target: 'global' });
    expect(res.ok).toBe(true);
    expect(res.target).toBe('global');
    expect(res.file.startsWith(globalDir)).toBe(true);

    const discovered = discoverSkills(root);
    const found = discovered.find((s) => s.name === 'owasp-guard');
    expect(found).toBeDefined();
    expect(found!.source).toBe('global');
  });

  it('prevents accidental overwrite unless overwrite: true is passed', async () => {
    await installFromGallery(root, 'api-designer');
    await expect(installFromGallery(root, 'api-designer', { overwrite: false })).rejects.toThrow(
      /already installed/,
    );

    const overwritten = await installFromGallery(root, 'api-designer', { overwrite: true });
    expect(overwritten.ok).toBe(true);
  });

  it('installs from raw content with frontmatter parsing', () => {
    const content = `---
name: my-custom-tool
description: Custom tool workflow
version: 1.0.0
author: Developer
license: MIT
---
# Instructions
Do work.
`;
    const res = installFromRawContent(root, 'my-custom-tool', content);
    expect(res.ok).toBe(true);
    expect(fs.existsSync(res.file)).toBe(true);

    const discovered = discoverSkills(root);
    const found = discovered.find((s) => s.name === 'my-custom-tool');
    expect(found).toBeDefined();
    expect(found!.description).toBe('Custom tool workflow');
  });

  it('installs from URL using injected fetcher', async () => {
    const mockContent = `---
name: fetched-skill
description: Fetched from remote
author: Remote Org
license: Apache-2.0
---
# Fetched
`;
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockContent,
    });

    const res = await installFromUrl(
      root,
      'https://github.com/org/repo/tree/main/skills/fetched-skill',
      {
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.ok).toBe(true);
    expect(res.name).toBe('fetched-skill');
    expect(fs.readFileSync(res.file, 'utf-8')).toContain('Fetched from remote');
  });

  it('installs from local directory by copy', () => {
    const srcDir = path.join(root, 'external-skill');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'SKILL.md'),
      '---\nname: copied-skill\ndescription: Copied from local\n---\n# Content',
    );
    fs.mkdirSync(path.join(srcDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'scripts', 'test.sh'), '#!/bin/bash');

    const res = installFromPath(root, srcDir);
    expect(res.ok).toBe(true);
    expect(res.name).toBe('copied-skill');
    expect(fs.existsSync(path.join(res.dir, 'scripts', 'test.sh'))).toBe(true);
  });

  it('uninstalls skills cleanly', async () => {
    await installFromGallery(root, 'system-architect');
    expect(discoverSkills(root).some((s) => s.name === 'system-architect')).toBe(true);

    const removed = uninstallSkill(root, 'system-architect');
    expect(removed).toBe(true);
    expect(discoverSkills(root).some((s) => s.name === 'system-architect')).toBe(false);

    // Uninstalling non-existent returns false
    expect(uninstallSkill(root, 'non-existent')).toBe(false);
  });
});
