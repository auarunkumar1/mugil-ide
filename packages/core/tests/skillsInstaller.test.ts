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
  resolveGitHubRawUrl,
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

  it('refuses to fetch a skill from a private/metadata address', async () => {
    const mockFetch = jest.fn();
    await expect(
      installFromUrl(root, 'http://169.254.169.254/latest/meta-data/iam/SKILL.md', {
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/private|local/i);
    expect(mockFetch).not.toHaveBeenCalled();

    // A public hostname that resolves to loopback is refused too.
    await expect(
      installFromUrl(root, 'https://evil.example.com/skills/x/SKILL.md', {
        fetchFn: mockFetch as unknown as typeof fetch,
        dnsLookupFn: async () => ({ address: '127.0.0.1', family: 4 }),
      }),
    ).rejects.toThrow(/private address/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('re-checks redirect hops for private addresses', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 302,
      statusText: 'Found',
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
      text: async () => '',
    });
    await expect(
      installFromUrl(root, 'https://example.com/skills/x/SKILL.md', {
        fetchFn: mockFetch as unknown as typeof fetch,
        dnsLookupFn: async () => ({ address: '93.184.216.34', family: 4 }),
      }),
    ).rejects.toThrow(/refusing to fetch local or private/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('rejects non-markdown bodies such as a GitHub HTML page', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<!doctype html><html><body>GitHub repo page</body></html>',
    });
    await expect(
      installFromUrl(root, 'https://example.com/skills/foo/SKILL.md', {
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/does not look like a SKILL.md/);
  });
  it('rewrites github blob URLs to raw and infers the parent dir as the name', () => {
    const { rawUrl, inferredName } = resolveGitHubRawUrl(
      'https://github.com/org/repo/blob/main/skills/my-skill/SKILL.md',
    );
    expect(rawUrl).toBe(
      'https://raw.githubusercontent.com/org/repo/main/skills/my-skill/SKILL.md',
    );
    expect(inferredName).toBe('my-skill');
  });
  it('does not copy VCS data, dotenv files or symlinks when importing a folder', () => {
    const srcDir = path.join(root, 'leaky-skill');
    fs.mkdirSync(path.join(srcDir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'SKILL.md'),
      '---\nname: leaky\ndescription: Leaky\n---\n# Content',
    );
    fs.writeFileSync(path.join(srcDir, '.env'), 'API_KEY=sk-live-123');
    fs.writeFileSync(path.join(srcDir, '.git', 'config'), 'secret');
    fs.writeFileSync(path.join(srcDir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1');
    fs.writeFileSync(path.join(srcDir, 'scripts', 'run.sh'), '#!/bin/bash');
    const secret = path.join(root, 'outside.txt');
    fs.writeFileSync(secret, 'SECRET');
    fs.symlinkSync(secret, path.join(srcDir, 'linked.txt'));
    const res = installFromPath(root, srcDir, { overwrite: true });
    expect(fs.existsSync(path.join(res.dir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(res.dir, 'scripts', 'run.sh'))).toBe(true);
    expect(fs.existsSync(path.join(res.dir, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(res.dir, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(res.dir, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(res.dir, 'linked.txt'))).toBe(false);
  });
  it('uninstalling a missing skill creates nothing on disk', () => {
    const ws = path.join(root, 'empty-ws');
    fs.mkdirSync(ws);
    expect(uninstallSkill(ws, 'ghost')).toBe(false);
    expect(fs.existsSync(path.join(ws, '.mugil'))).toBe(false);
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
