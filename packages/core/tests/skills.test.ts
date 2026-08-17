import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  discoverSkills,
  loadSkill,
  parseSkillFrontmatter,
  skillsContextBlock,
} from '../src/modules/skills/index.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import type { ToolCall } from '../src/types.js';

describe('parseSkillFrontmatter', () => {
  it('parses name and description from the frontmatter block', () => {
    const text = '---\nname: my-skill\ndescription: Does a specialized thing\n---\n# Body\nDo the thing.\n';
    expect(parseSkillFrontmatter(text)).toEqual({
      name: 'my-skill',
      description: 'Does a specialized thing',
    });
  });

  it('returns {} when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a doc')).toEqual({});
  });
});

describe('skills harness', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-skills-'));

  beforeAll(() => {
    const dir = path.join(root, '.agents', 'skills', 'demo-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: Demo workflow for testing\n---\n# Demo Skill\nStep 1: do a.\nStep 2: do b.\n',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers skills with parsed metadata', () => {
    const skills = discoverSkills(root);
    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe('demo-skill');
    expect(skills[0]!.description).toBe('Demo workflow for testing');
    expect(skills[0]!.file.endsWith('SKILL.md')).toBe(true);
  });

  it('loads the full skill body on demand', () => {
    const content = loadSkill(root, 'demo-skill');
    expect(content).toContain('Step 1: do a.');
    expect(content).toContain('Demo workflow for testing');
  });

  it('returns null for unknown skills', () => {
    expect(loadSkill(root, 'nope')).toBeNull();
  });

  it('builds a low-token context block listing skills', () => {
    const block = skillsContextBlock(root);
    expect(block).toContain('Available skills');
    expect(block).toContain('demo-skill — Demo workflow for testing');
  });

  it('is empty when no skill directories exist', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-noskills-'));
    expect(skillsContextBlock(empty)).toBe('');
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('exposes a skill tool that returns the loaded instructions', async () => {
    const { tools, toolRegistry } = createWorkspaceTools(root);
    expect(tools.map((t) => t.name)).toContain('skill');

    const call: ToolCall = { id: 's1', name: 'skill', arguments: JSON.stringify({ name: 'demo-skill' }) };
    const out = await toolRegistry.skill(call);
    expect(out).toContain('Step 1: do a.');

    const missing: ToolCall = { id: 's2', name: 'skill', arguments: JSON.stringify({ name: 'nope' }) };
    const miss = await toolRegistry.skill(missing);
    expect(miss).toContain('unknown skill "nope"');
    expect(miss).toContain('demo-skill');
  });
});
