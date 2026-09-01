/**
 * Tool Permissions
 * ================
 * allow / ask / deny policy for agent tool calls, following the established
 * coding-agent pattern from OpenCode (sst/opencode) and Claude Code:
 * every tool call is gated by a policy, and a denied call is fed back to the
 * model as a tool result so it can recover (ask a human, choose another path).
 *
 * Credit: permission model inspired by OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import type { ToolCall } from '../../types.js';

export type ToolPermissionAction = 'allow' | 'ask' | 'deny';

export interface BashRule {
  /** Glob-ish pattern matched against the full command string. `*` = any chars. */
  pattern: string;
  action: ToolPermissionAction;
}

export interface PermissionPolicy {
  /** Per-tool action; tools without an entry default to 'allow'. */
  tools?: Record<string, ToolPermissionAction>;
  /** Bash command policy (applies to run_command). */
  bash?: {
    /** Action for commands matching no rule. Default 'allow'. */
    defaultAction?: ToolPermissionAction;
    /** Ordered rules; the LAST matching rule wins (OpenCode semantics). */
    rules?: BashRule[];
  };
  /**
   * Prefix rules applied after the exact per-tool lookup (last match wins),
   * e.g. every `mcp_` tool asks in act mode and is denied in plan mode.
   */
  toolPrefixRules?: { prefix: string; action: ToolPermissionAction }[];
}

/** Reads tools — safe to expose to every agent without approval. */
export const READ_TOOLS = ['read_file', 'read_skeleton', 'list_files', 'search_code', 'codegraph', 'todoread', 'skill', 'webfetch', 'websearch', 'lsp'];
/** Write tools — mutate the workspace. */
export const WRITE_TOOLS = ['write_file', 'edit_file', 'apply_patch', 'todowrite'];
/** Execution tools — run arbitrary shell commands. */
export const EXEC_TOOLS = ['run_command'];

/** A permission check gates one tool call. Returns true to allow, false to deny. */
export type PermissionCheck = (call: ToolCall) => boolean | Promise<boolean>;

/**
 * Mode-based defaults, mirroring OpenCode's built-in agents:
 * - plan: read-only — writes, edits and commands are denied outright.
 * - act:  reads are free; writes, edits and commands ask for approval.
 */
export function defaultPolicyForMode(mode: 'plan' | 'act'): PermissionPolicy {
  if (mode === 'plan') {
    return {
      tools: { write_file: 'deny', edit_file: 'deny', apply_patch: 'deny', run_command: 'deny', todowrite: 'deny' },
      bash: { defaultAction: 'deny', rules: [] },
      // External MCP tools are never auto-run during read-only planning.
      toolPrefixRules: [{ prefix: 'mcp_', action: 'deny' }],
    };
  }
  return {
    tools: { write_file: 'ask', edit_file: 'ask', apply_patch: 'ask', todowrite: 'ask' },
    bash: { defaultAction: 'ask', rules: [] },
    // MCP tools come from third-party servers — ask before running them.
    toolPrefixRules: [{ prefix: 'mcp_', action: 'ask' }],
  };
}

/** Resolves the effective action for one tool call under a policy. */
export function resolveToolPermission(
  policy: PermissionPolicy | undefined,
  call: ToolCall,
): ToolPermissionAction {
  if (!policy) return 'allow';    if (call.name === 'run_command') {
      const bash = policy.bash;
      if (!bash) return applyPrefixRules(policy, call.name, policy.tools?.[call.name] ?? 'allow');
      let action = bash.defaultAction ?? policy.tools?.[call.name] ?? 'allow';
      const command = commandForCall(call);
      if (command !== null) {
        for (const rule of bash.rules ?? []) {
          if (rule.action && patternToRegExp(rule.pattern).test(command)) {
            action = rule.action;
          }
        }
      }
      return action;
    }
    return applyPrefixRules(policy, call.name, policy.tools?.[call.name] ?? 'allow');
  }

/**
 * Applies per-tool action overrides on top of a base policy, returning a new
 * policy (the base is never mutated). `run_command` overrides map to the bash
 * `defaultAction`, which is the knob the resolver actually consults when a
 * `bash` section is present. Used by the TUI to persist user-tuned policies
 * per mode (see `MUGIL_IDE_TOOL_PERMISSIONS`).
 */
export function applyPermissionOverrides(
  base: PermissionPolicy,
  overrides: Record<string, ToolPermissionAction>,
): PermissionPolicy {
  const tools = { ...(base.tools ?? {}) };
  const bash = base.bash
    ? { ...base.bash, rules: [...(base.bash.rules ?? [])] }
    : undefined;
  for (const [tool, action] of Object.entries(overrides)) {
    if (tool === 'run_command') {
      if (bash) bash.defaultAction = action;
      else tools.run_command = action;
    } else {
      tools[tool] = action;
    }
  }
  return {
    tools,
    bash,
    toolPrefixRules: base.toolPrefixRules ? [...base.toolPrefixRules] : undefined,
  };
}

/** Applies prefix rules after the exact lookup; last matching rule wins. */
function applyPrefixRules(
  policy: PermissionPolicy,
  toolName: string,
  fallback: ToolPermissionAction,
): ToolPermissionAction {
  let action = fallback;
  for (const rule of policy.toolPrefixRules ?? []) {
    if (rule.action && toolName.startsWith(rule.prefix)) action = rule.action;
  }
  return action;
}

/**
 * Builds a PermissionCheck from a policy. 'ask' actions delegate to `onAsk`
 * (the interactive UI); without a handler, an 'ask' action is treated as
 * 'deny' so headless callers never auto-approve side-effectful tools.
 */
export function createPermissionCheck(
  policy: PermissionPolicy | undefined,
  onAsk?: (call: ToolCall) => boolean | Promise<boolean>,
): PermissionCheck {
  return (call) => {
    const action = resolveToolPermission(policy, call);
    if (action === 'allow') return true;
    if (action === 'deny') return false;
    return onAsk ? onAsk(call) : false;
  };
}

/** Escapes a glob-ish pattern into an anchored RegExp (`*` matches any chars). */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function commandForCall(call: ToolCall): string | null {
  try {
    const args = JSON.parse(call.arguments) as { command?: unknown };
    return typeof args.command === 'string' ? args.command : null;
  } catch {
    return null;
  }
}
