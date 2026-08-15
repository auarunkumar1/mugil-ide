import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveFileContext } from '../src/contextResolver.js';

describe('resolveFileContext', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-ctx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves @filepath and embeds file content', () => {
    const filePath = path.join(tempDir, 'sample.ts');
    fs.writeFileSync(filePath, 'export const greeting = "hello world";', 'utf-8');

    const prompt = 'Please review @sample.ts for any bugs';
    const result = resolveFileContext(prompt, tempDir);

    expect(result.attachedFiles).toContain('sample.ts');
    expect(result.resolvedPrompt).toContain('--- Context from attached local files ---');
    expect(result.resolvedPrompt).toContain('export const greeting = "hello world";');
    expect(result.resolvedPrompt).toContain('sample.ts');
  });

  it('resolves @"quoted file with spaces.txt"', () => {
    const filePath = path.join(tempDir, 'my config file.json');
    fs.writeFileSync(filePath, '{"version": 1}', 'utf-8');

    const prompt = 'Check @"my config file.json"';
    const result = resolveFileContext(prompt, tempDir);

    expect(result.attachedFiles).toContain('my config file.json');
    expect(result.resolvedPrompt).toContain('{"version": 1}');
  });

  it('handles non-existent files gracefully with a warning', () => {
    const prompt = 'Look at @non_existent_file.rs please';
    const result = resolveFileContext(prompt, tempDir);

    expect(result.attachedFiles).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('File not found: @non_existent_file.rs');
    expect(result.resolvedPrompt).toBe(prompt);
  });

  it('ignores email addresses', () => {
    const prompt = 'Send email to user@example.com';
    const result = resolveFileContext(prompt, tempDir);

    expect(result.attachedFiles).toHaveLength(0);
    expect(result.resolvedPrompt).toBe(prompt);
  });
});
