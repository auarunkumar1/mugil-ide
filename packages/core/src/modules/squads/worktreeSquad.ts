/**
 * Multi-Agent Worktree Squad Orchestration
 * ========================================
 * Manages isolated Git worktree environments for concurrent subagents,
 * preventing subagents from colliding or stepping on each other's workspace files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  agentId: string;
  worktreePath: string;
  branch: string;
}

export class WorktreeSquadManager {
  private activeWorktrees = new Map<string, WorktreeInfo>();

  constructor(private workspaceRoot: string) {}

  /** Checks if the workspace root is inside a git repository. */
  async isGitRepo(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: this.workspaceRoot,
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Prepares an isolated git worktree for a subagent.
   * If git is unavailable, safely creates an isolated scratch directory.
   */
  async createWorktree(agentId: string, branchName?: string): Promise<WorktreeInfo> {
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branch = branchName ?? `mugil/squad-${safeId}-${Date.now().toString(36)}`;
    const worktreeDir = path.join(this.workspaceRoot, '.mugil', 'worktrees', safeId);

    // Clean up any stale directory if it exists
    if (fs.existsSync(worktreeDir)) {
      try {
        await this.cleanupWorktree(safeId);
      } catch {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    }

    const hasGit = await this.isGitRepo();
    if (!hasGit) {
      // Fallback: create scratch directory
      fs.mkdirSync(worktreeDir, { recursive: true });
      const info: WorktreeInfo = { agentId, worktreePath: worktreeDir, branch: 'no-git' };
      this.activeWorktrees.set(agentId, info);
      return info;
    }

    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreeDir, 'HEAD'], {
        cwd: this.workspaceRoot,
      });
    } catch {
      // Branch might already exist or HEAD is detached; try without -b
      await execFileAsync('git', ['worktree', 'add', worktreeDir], {
        cwd: this.workspaceRoot,
      });
    }

    const info: WorktreeInfo = { agentId, worktreePath: worktreeDir, branch };
    this.activeWorktrees.set(agentId, info);
    return info;
  }

  /** Removes a subagent's worktree and cleans up disk state. */
  async cleanupWorktree(agentId: string, options: { deleteBranch?: boolean } = {}): Promise<void> {
    const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const info = this.activeWorktrees.get(agentId) ?? this.activeWorktrees.get(safeId);
    const worktreeDir = info?.worktreePath ?? path.join(this.workspaceRoot, '.mugil', 'worktrees', safeId);

    const hasGit = await this.isGitRepo();
    if (hasGit) {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], {
          cwd: this.workspaceRoot,
        });
      } catch {
        // Fallback to manual removal if git worktree remove fails
        if (fs.existsSync(worktreeDir)) {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        }
        try {
          await execFileAsync('git', ['worktree', 'prune'], { cwd: this.workspaceRoot });
        } catch {
          // ignore
        }
      }

      if (options.deleteBranch && info?.branch && info.branch !== 'no-git') {
        try {
          await execFileAsync('git', ['branch', '-D', info.branch], { cwd: this.workspaceRoot });
        } catch {
          // ignore
        }
      }
    } else {
      if (fs.existsSync(worktreeDir)) {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    }

    this.activeWorktrees.delete(agentId);
    this.activeWorktrees.delete(safeId);
  }

  /** Lists currently active worktrees. */
  getActiveWorktrees(): WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }
}
