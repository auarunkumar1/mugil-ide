/**
 * Undo / Redo for tool edits
 * ==========================
 * OpenCode-style edit snapshots: every successful `write_file` / `edit_file`
 * tool call records the file's state before AND after the mutation; `/undo`
 * restores the before-state (or removes a file the tool created) and `/redo`
 * re-applies the after-state. Stacks are per-workspace-root (like the todo
 * store), capped at 50 edits, and a new edit clears the redo stack.
 *
 * Snapshots live in memory for the process lifetime — they do not survive a
 * TUI restart. `run_command` effects and MCP-tool writes are NOT undoable
 * (their side effects are unknowable); only the workspace file tools record.
 *
 * Credit: undo/redo semantics inspired by OpenCode — https://github.com/sst/opencode.
 * See ATTRIBUTIONS.md for the full list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** File state at a point in time (before or after a mutation). */
export interface FileState {
  /** File content at this point ('' when the file did not exist). */
  content: string;
  /** Whether the file existed at this point. */
  existed: boolean;
}

/** One recorded tool edit: before/after states + display info. */
export interface UndoEdit {
  /** Absolute path of the edited file. */
  path: string;
  /** Workspace-relative path (for TUI messages). */
  rel: string;
  before: FileState;
  after: FileState;
  /**
   * For `apply_patch` moves: the absolute destination the file was renamed
   * to. Undo restores the source and removes the destination; redo re-creates
   * the destination and removes the restored source.
   */
  movedTo?: string;
}

export interface UndoResult {
  /** Workspace-relative path of the affected file. */
  path: string;
  action: 'restored' | 'removed' | 're-applied' | 'recreated';
  message: string;
}

const undoStacks = new Map<string, UndoEdit[]>();
const redoStacks = new Map<string, UndoEdit[]>();
const MAX_UNDO = 50;
/**
 * Edits whose before OR after content exceeds this many characters are NOT
 * recorded. Full snapshots of huge files (generated code, minified assets,
 * vendored bundles) would pin megabytes in memory per edit — 50 edits × 2
 * sides × content size per workspace root. Oversized edits still apply on
 * disk; they're simply not undoable via /undo and don't appear in the diff
 * viewer. The tools surface a note in their result when an edit is skipped.
 */
export const MAX_UNDO_CONTENT_CHARS = 256 * 1024;

function stackFor(map: Map<string, UndoEdit[]>, root: string): UndoEdit[] {
  let stack = map.get(root);
  if (!stack) {
    stack = [];
    map.set(root, stack);
  }
  return stack;
}

/** Captures the current on-disk state of a file (before a mutation). */
export function captureFile(root: string, target: string): FileState {
  const abs = path.resolve(target);
  const existed = fs.existsSync(abs);
  return {
    content: existed ? fs.readFileSync(abs, 'utf-8') : '',
    existed,
  };
}

/**
 * Records an edit (call after the mutation succeeded) and clears the redo stack.
 * Returns '' when recorded, or a short note when the edit was skipped because
 * its before/after content exceeds MAX_UNDO_CONTENT_CHARS — callers append the
 * note to their result so the model/user knows the edit isn't undoable.
 */
export function pushEdit(root: string, edit: Omit<UndoEdit, 'rel'>): string {
  if (edit.before.content.length > MAX_UNDO_CONTENT_CHARS || edit.after.content.length > MAX_UNDO_CONTENT_CHARS) {
    return 'file too large to snapshot for /undo';
  }
  const stack = stackFor(undoStacks, root);
  stack.push({
    ...edit,
    rel: path.relative(root, edit.path).replace(/\\/g, '/'),
  });
  if (stack.length > MAX_UNDO) stack.shift();
  redoStacks.delete(root);
  return '';
}

/** Applies a state to disk (writes content back, or removes a created file). */
function applyState(edit: UndoEdit, state: FileState): void {
  if (state.existed) {
    fs.mkdirSync(path.dirname(edit.path), { recursive: true });
    fs.writeFileSync(edit.path, state.content, 'utf-8');
  } else if (fs.existsSync(edit.path)) {
    fs.rmSync(edit.path, { force: true });
  }
}

/** Workspace-relative display path (POSIX separators). */
function relOf(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

/**
 * Applies a recorded `apply_patch` move. Undo (undoing=true) restores the
 * source file at its original path and removes the moved-to copy so no
 * duplicate remains; redo (undoing=false) re-creates the destination from
 * the source content and removes the restored source, so the file is never
 * lost and never duplicated.
 */
function applyMoveState(edit: UndoEdit, undoing: boolean): void {
  const dest = edit.movedTo!;
  if (undoing) {
    if (edit.before.existed) {
      fs.mkdirSync(path.dirname(edit.path), { recursive: true });
      fs.writeFileSync(edit.path, edit.before.content, 'utf-8');
    }
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  } else {
    if (edit.before.existed) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, edit.before.content, 'utf-8');
    }
    if (fs.existsSync(edit.path)) fs.rmSync(edit.path, { force: true });
  }
}

/** Undoes the most recent edit for a root. Returns null when the stack is empty. */
export function undoLast(root: string): UndoResult | null {
  const stack = stackFor(undoStacks, root);
  const edit = stack.pop();
  if (!edit) return null;
  try {
    if (edit.movedTo) applyMoveState(edit, true);
    else applyState(edit, edit.before);
    stackFor(redoStacks, root).push(edit);
    return {
      path: edit.rel,
      action: edit.movedTo ? 'restored' : edit.before.existed ? 'restored' : 'removed',
      message: edit.movedTo
        ? `Reverted ${edit.rel} (moved back from ${relOf(root, edit.movedTo)})`
        : edit.before.existed
          ? `Reverted ${edit.rel} (restored previous content)`
          : `Reverted ${edit.rel} (removed created file)`,
    };
  } catch (err) {
    // Restore failed (e.g. permissions) — keep the edit on the stack to retry.
    stack.push(edit);
    return {
      path: edit.rel,
      action: 'restored',
      message: `Reverting ${edit.rel} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Re-applies the most recently undone edit for a root. Returns null when empty. */
export function redoLast(root: string): UndoResult | null {
  const stack = stackFor(redoStacks, root);
  const edit = stack.pop();
  if (!edit) return null;
  try {
    if (edit.movedTo) applyMoveState(edit, false);
    else applyState(edit, edit.after);
    stackFor(undoStacks, root).push(edit);
    return {
      path: edit.rel,
      action: edit.movedTo ? 're-applied' : edit.after.existed ? 're-applied' : 'recreated',
      message: edit.movedTo
        ? `Re-applied ${edit.rel} (moved to ${relOf(root, edit.movedTo)})`
        : edit.after.existed
          ? `Re-applied ${edit.rel} (restored edited content)`
          : `Re-applied ${edit.rel} (recreated file)`,
    };
  } catch (err) {
    stack.push(edit);
    return {
      path: edit.rel,
      action: 're-applied',
      message: `Re-applying ${edit.rel} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Number of pending undos for a root (TUI status). */
export function undoDepth(root: string): number {
  return (undoStacks.get(root) ?? []).length;
}

/** Number of pending redos for a root (TUI status). */
export function redoDepth(root: string): number {
  return (redoStacks.get(root) ?? []).length;
}

/** Get list of recorded edits for a workspace root. */
export function getRecordedEdits(root: string): UndoEdit[] {
  return [...(undoStacks.get(root) ?? [])];
}
