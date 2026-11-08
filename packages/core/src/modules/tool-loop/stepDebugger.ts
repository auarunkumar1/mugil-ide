/**
 * Interactive Step Debugger for Tool Execution
 * ============================================
 * Allows developers to pause, inspect, edit tool call arguments, skip, or abort
 * tool executions before they execute against the workspace.
 */

import type { ToolCall } from '../../types.js';

export type StepAction = 'approve' | 'edit' | 'skip' | 'abort';

export interface StepDecision {
  action: StepAction;
  modifiedArguments?: string;
  skipOutput?: string;
}

export interface ToolBreakpoint {
  id: string;
  call: ToolCall;
  timestamp: number;
}

export class StepDebugger {
  private enabled = false;
  private pendingResolvers = new Map<string, (decision: StepDecision) => void>();
  private onBreakpointCallback?: (bp: ToolBreakpoint) => void;

  constructor(options: { enabled?: boolean; onBreakpoint?: (bp: ToolBreakpoint) => void } = {}) {
    this.enabled = options.enabled ?? false;
    this.onBreakpointCallback = options.onBreakpoint;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (!val) {
      // Auto-approve any pending breakpoints if disabled mid-run
      this.cancelAll('approve');
    }
  }

  setOnBreakpoint(cb?: (bp: ToolBreakpoint) => void): void {
    this.onBreakpointCallback = cb;
  }

  /**
   * Intercepts a tool call before execution.
   * If debugger is disabled, approves immediately.
   * Otherwise halts and awaits user decision from UI or API.
   */
  async intercept(call: ToolCall): Promise<StepDecision> {
    if (!this.enabled) {
      return { action: 'approve' };
    }

    const bpId = call.id || `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const bp: ToolBreakpoint = {
      id: bpId,
      call,
      timestamp: Date.now(),
    };

    return new Promise<StepDecision>((resolve) => {
      this.pendingResolvers.set(bpId, resolve);
      this.onBreakpointCallback?.(bp);
    });
  }

  /** Resolves a pending breakpoint by ID with the chosen action. */
  resolveBreakpoint(id: string, decision: StepDecision): boolean {
    const resolver = this.pendingResolvers.get(id);
    if (!resolver) return false;
    this.pendingResolvers.delete(id);
    resolver(decision);
    return true;
  }

  /** Cancels or auto-resolves all pending breakpoints. */
  cancelAll(fallbackAction: StepAction = 'abort'): void {
    for (const [id, resolver] of this.pendingResolvers.entries()) {
      resolver({ action: fallbackAction });
    }
    this.pendingResolvers.clear();
  }

  getPendingBreakpoints(): string[] {
    return Array.from(this.pendingResolvers.keys());
  }
}

/** Global step debugger singleton. */
export const globalStepDebugger = new StepDebugger();
