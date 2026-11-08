import { StepDebugger } from '../src/modules/tool-loop/stepDebugger.js';
import type { ToolCall } from '../src/types.js';

describe('StepDebugger', () => {
  let dbg: StepDebugger;

  beforeEach(() => {
    dbg = new StepDebugger();
  });

  it('approves immediately when disabled', async () => {
    dbg.setEnabled(false);
    const call: ToolCall = { id: 'c1', name: 'write_file', arguments: '{}' };
    const decision = await dbg.intercept(call);
    expect(decision.action).toBe('approve');
  });

  it('pauses and emits breakpoint when enabled, resuming on approve', async () => {
    dbg.setEnabled(true);
    let capturedBpId = '';
    dbg.setOnBreakpoint((bp) => {
      capturedBpId = bp.id;
    });

    const call: ToolCall = { id: 'c2', name: 'run_command', arguments: '{"command":"rm -rf /"}' };
    const interceptPromise = dbg.intercept(call);

    expect(capturedBpId).toBe('c2');
    expect(dbg.getPendingBreakpoints()).toContain('c2');

    // User approves
    dbg.resolveBreakpoint(capturedBpId, { action: 'approve' });
    const decision = await interceptPromise;
    expect(decision.action).toBe('approve');
    expect(dbg.getPendingBreakpoints()).toHaveLength(0);
  });

  it('supports modifying tool arguments before execution', async () => {
    dbg.setEnabled(true);
    dbg.setOnBreakpoint((bp) => {
      dbg.resolveBreakpoint(bp.id, {
        action: 'edit',
        modifiedArguments: '{"command":"ls -la"}',
      });
    });

    const call: ToolCall = { id: 'c3', name: 'run_command', arguments: '{"command":"dangerous"}' };
    const decision = await dbg.intercept(call);
    expect(decision.action).toBe('edit');
    expect(decision.modifiedArguments).toBe('{"command":"ls -la"}');
  });

  it('supports skipping tool execution with synthetic output', async () => {
    dbg.setEnabled(true);
    dbg.setOnBreakpoint((bp) => {
      dbg.resolveBreakpoint(bp.id, {
        action: 'skip',
        skipOutput: 'Simulated output',
      });
    });

    const call: ToolCall = { id: 'c4', name: 'run_command', arguments: '{}' };
    const decision = await dbg.intercept(call);
    expect(decision.action).toBe('skip');
    expect(decision.skipOutput).toBe('Simulated output');
  });

  it('cancels all pending breakpoints on cancelAll', async () => {
    dbg.setEnabled(true);
    const call: ToolCall = { id: 'c5', name: 'write_file', arguments: '{}' };
    const interceptPromise = dbg.intercept(call);

    dbg.cancelAll('abort');
    const decision = await interceptPromise;
    expect(decision.action).toBe('abort');
  });
});
