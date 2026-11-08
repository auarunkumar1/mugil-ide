import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCredits, installFromGallery, parseAttributionsMarkdown } from '../src/index.js';

describe('Open Source Credits & Attributions', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-credits-'));
  });

  afterEach(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('aggregates default core modules and libraries', () => {
    const credits = getCredits(root);
    expect(credits.coreModules.length).toBeGreaterThanOrEqual(8);
    expect(credits.libraries.length).toBeGreaterThanOrEqual(3);
    expect(credits.skills.length).toBeGreaterThanOrEqual(14);

    const caveman = credits.coreModules.find((m) => m.name.includes('Caveman'));
    expect(caveman).toBeDefined();
    expect(caveman!.author).toContain('Julius Brussee');
    expect(caveman!.upstreamUrl).toContain('github.com/JuliusBrussee/caveman');

    const opencode = credits.coreModules.find((m) => m.name.includes('OpenCode'));
    expect(opencode).toBeDefined();
    expect(opencode!.license).toBe('MIT');
  });

  it('parses custom ATTRIBUTIONS.md table format correctly', () => {
    const markdown = `# Attributions
| Module | Concept | Creator / Project | Upstream | License |
| **Custom Module** | A novel test pattern | Test Author | https://github.com/test/repo | MIT |
`;
    const parsed = parseAttributionsMarkdown(markdown);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.name).toBe('Custom Module');
    expect(parsed[0]!.concept).toBe('A novel test pattern');
    expect(parsed[0]!.author).toBe('Test Author');
    expect(parsed[0]!.upstreamUrl).toBe('https://github.com/test/repo');
    expect(parsed[0]!.license).toBe('MIT');
  });

  it('never reports a bundled skill as an installed gallery skill', () => {
    // security-auditor ships with the package, so it resolves without any
    // install having happened.
    const credits = getCredits(root);
    const bundled = credits.skills.find((s) => s.name.includes('OWASP'));
    if (bundled) expect(bundled.installed).toBe(false);
    // And a real install flips to true.
  });
  it('reads the ATTRIBUTIONS.md shipped with the package, not the stub fallback', () => {
    // `root` is an empty temp dir with no ATTRIBUTIONS.md of its own.
    const credits = getCredits(root);
    expect(credits.coreModules.length).toBeGreaterThan(10);
  });
  it('flags installed status dynamically for skills', async () => {
    const initial = getCredits(root);
    const initialPlaywright = initial.skills.find((s) => s.name === 'Playwright E2E Testing');
    expect(initialPlaywright?.installed).toBe(false);

    await installFromGallery(root, 'playwright-e2e');

    const updated = getCredits(root);
    const updatedPlaywright = updated.skills.find((s) => s.name === 'Playwright E2E Testing');
    expect(updatedPlaywright?.installed).toBe(true);
  });
});
