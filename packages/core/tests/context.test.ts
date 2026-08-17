import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildEnvironmentContext,
  findProjectContextFiles,
} from '../src/modules/tools/context.js';

describe('buildEnvironmentContext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-ctx-'));

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includes working directory, platform and date', () => {
    const ctx = buildEnvironmentContext(dir);
    expect(ctx).toContain(`Working directory: ${dir}`);
    expect(ctx).toContain(`Platform: ${os.platform()}`);
    expect(ctx).toContain(`Today's date: ${new Date().toDateString()}`);
  });

  it('includes project context files (AGENTS.md / CLAUDE.md)', () => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Always run typecheck before committing.\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Terse answers only.\n');
    const ctx = buildEnvironmentContext(dir);
    expect(ctx).toContain('AGENTS.md');
    expect(ctx).toContain('Always run typecheck before committing.');
    expect(ctx).toContain('CLAUDE.md');
    expect(ctx).toContain('Terse answers only.');
    fs.rmSync(path.join(dir, 'AGENTS.md'));
    fs.rmSync(path.join(dir, 'CLAUDE.md'));
  });

  it('walks up to the home directory and keeps the nearest file per name', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-ctx-parent-'));
    const child = path.join(parent, 'sub');
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(parent, 'AGENTS.md'), 'parent-level rules\n');
    fs.writeFileSync(path.join(child, 'AGENTS.md'), 'child-level rules\n');
    fs.writeFileSync(path.join(child, 'CLAUDE.md'), 'child claude\n');

    const files = findProjectContextFiles(child);
    const agents = files.find((f) => path.basename(f.file) === 'AGENTS.md')!;
    const claude = files.find((f) => path.basename(f.file) === 'CLAUDE.md')!;
    // Nearest AGENTS.md wins; CLAUDE.md has no parent copy, so the child one is kept.
    expect(agents.content).toContain('child-level rules');
    expect(agents.content).not.toContain('parent-level rules');
    expect(claude.content).toContain('child claude');
    expect(files.length).toBe(2);

    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('truncates oversized context files with a marker', () => {
    const file = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(file, 'x'.repeat(120_000));
    const ctx = buildEnvironmentContext(dir);
    expect(ctx).toContain('truncated at 100000 chars');
    fs.rmSync(file);
  });
});
