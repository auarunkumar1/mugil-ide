import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorktreeSquadManager } from '../src/modules/squads/worktreeSquad.js';

describe('WorktreeSquadManager', () => {
  let tmpDir: string;
  let manager: WorktreeSquadManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-squad-test-'));
    manager = new WorktreeSquadManager(tmpDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects non-git directories and falls back cleanly to isolated scratch folder', async () => {
    const isGit = await manager.isGitRepo();
    expect(isGit).toBe(false);

    const info = await manager.createWorktree('subagent-1');
    expect(info.agentId).toBe('subagent-1');
    expect(info.branch).toBe('no-git');
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    expect(manager.getActiveWorktrees()).toHaveLength(1);

    await manager.cleanupWorktree('subagent-1');
    expect(fs.existsSync(info.worktreePath)).toBe(false);
    expect(manager.getActiveWorktrees()).toHaveLength(0);
  });
});
