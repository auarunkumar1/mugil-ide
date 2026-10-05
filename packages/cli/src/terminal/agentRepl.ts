import type {
  Engine,
  ChatMessage,
  PipelineEvent,
  ModelSpec,
  PermissionCheck,
  ToolCall,
  ToolPermissionAction,
  McpToolsBundle,
  SessionEntry,
  SessionStats,
} from '@mugil-ide/core';
import {
  fetchProviderModels,
  undoLast,
  buildCodeGraph,
  queryCodeGraph,
  createWorkspaceTools,
  budgetConversationHistory,
  getHistoryBudget,
  countTokens,
  buildEnvironmentContext,
  createPermissionCheck,
  defaultPolicyForMode,
  applyPermissionOverrides,
  diagnosticsEnabledFromEnv,
readUserEnv,
connectMcpServers,
  parseMcpServerConfigs,
  skillsContextBlock,
  renderConversationForSummary,
  saveSession,
  loadSessionFile,
  listSessions,
  clearSession,
  namedSessionPath,
  loadMode,
  saveMode,
  type ConversationTurn,
} from '@mugil-ide/core';
import { ANSI, c, bold, dim, cyan, green, yellow, red, magenta, formatMarkdown } from './ansi.js';

export interface ReplIO {
  write: (data: string) => void;
  onLine?: (cb: (line: string) => void) => void;
  onExit?: () => void;
  onTurnComplete?: (turn: SessionTurn) => void;
  onModelChange?: (model: string, provider?: string) => void;
}

export interface SessionTurn {
  id: number;
  prompt: string;
  response: string;
  model: string;
  timestamp: number;
  tokens: { prompt: number; completion: number; total: number; saved: number };
  toolsCalled: Array<{ name: string; args: any; result?: string; ok?: boolean }>;
  filesModified: string[];
}

/**
 * Act mode: the agent is expected to carry work out on disk, not describe it.
 */
const ACT_MODE_INSTRUCTION =
  'You are an autonomous coding agent with access to tools. When the user asks to create, modify, or delete files, use the appropriate tools (write_file, edit_file, apply_patch, run_command) to make the actual changes on disk. Do not just describe what you would do — do it using your tools. Do not stop at planning. Read if you need context, then immediately execute the changes using your tools. Never return a plan or todo list without also executing the work.';

/**
 * Plan mode: read-only. The permission layer denies writes and commands, so
 * asking for them wastes a full model round-trip per attempt and produces a
 * confusing denial in the transcript. The agent's job here is to produce a
 * plan the user can approve, and to gather whatever context it needs first.
 */
const PLAN_MODE_INSTRUCTION =
  'You are a planning agent in READ-ONLY plan mode. Use the read tools (read_file, read_skeleton, list_files, search_code, codegraph, lsp, skill, webfetch, websearch) and todowrite to gather context and build a plan. ' +
  'Do NOT call write_file, edit_file, apply_patch or run_command — they are denied by policy in this mode, and asking again just wastes tokens. ' +
  'Deliver: (1) the files and symbols you found, with file:line references, (2) a concrete ordered plan of the changes to make, (3) any risks, unknowns or decisions you need the user to make. ' +
  'Be specific enough that the work can be executed mechanically. Do not write placeholder code — describe the changes instead.';

export interface ReplSessionStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHits: number;
  requests: number;
  tokensSaved: number;
  filesModified: Set<string>;
}

export interface AgentReplOptions {
  /**
   * Interactive handler for the `question` tool. The web server wires this to
   * a browser picker over WebSocket; without it the tool reports that no
   * handler is wired (headless callers never hang).
   */
  onQuestion?: (q: { header?: string; question: string; options: string[] }) => Promise<string>;
  /**
   * Interactive approval handler for `ask`-gated tool calls. The web server
   * wires this to an approval modal over WebSocket; without it, `ask` actions
   * are treated as denied (headless callers never auto-approve).
   */
  onAsk?: (call: ToolCall) => boolean | Promise<boolean>;
}

export class AgentRepl {
  private engine: Engine;
  private io: ReplIO;
  private options: AgentReplOptions;
  private activeModel: string;
  private mode: 'plan' | 'act' = 'act';
  /** Abort handle for the turn currently in flight; null when idle. */
  private turnAbort: AbortController | null = null;
  private isProcessing = false;
  private messageHistory: ChatMessage[] = [];
  public turns: SessionTurn[] = [];
  private shimmerInterval: NodeJS.Timeout | null = null;
  private shimmerHue = 0;
  private mcpConnecting: Promise<McpToolsBundle> | null = null;
  public stats: ReplSessionStats = AgentRepl.defaultStats();

  constructor(engine: Engine, io: ReplIO, initialModel?: string, options: AgentReplOptions = {}) {
    this.engine = engine;
    this.io = io;
    this.options = options;
    this.activeModel =
      initialModel ||
      process.env.MUGIL_IDE_MODEL ||
      (engine.config.models && engine.config.models[0]?.id) ||
      'openrouter/auto';
    // Restore persisted mode (default: 'act'). Scoped to this workspace, with
    // an explicit env override taking precedence. MUGIL_IDE_MODE used to be
    // written to the global user env file, which made plan mode in one repo
    // silently apply to every other repo on the machine.
    const savedMode = process.env.MUGIL_IDE_MODE || loadMode();
    if (savedMode === 'plan' || savedMode === 'act') {
      this.mode = savedMode;
    }
    // Auto-resume the last session for this workspace (no-op when none is
    // saved) — restores the conversation AND its token/savings stats.
    const resumed = loadSessionFile();
    this.restoreSessionEntries(resumed.entries);
    this.restoreSessionStats(resumed.stats);
  }

  /** Fresh zeroed stats — used at construction and on `/reset`. */
  private static defaultStats(): ReplSessionStats {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHits: 0,
      requests: 0,
      tokensSaved: 0,
      filesModified: new Set<string>(),
    };
  }

  /** Closes long-lived connections (MCP stdio children). */
  public async dispose(): Promise<void> {
    if (this.mcpConnecting) {
      try {
        const bundle = await this.mcpConnecting;
        await bundle.close();
      } catch {
        // best-effort teardown
      }
      this.mcpConnecting = null;
    }
  }

  public getActiveModel(): string {
    return this.activeModel;
  }

  public getMode(): 'plan' | 'act' {
    return this.mode;
  }

  public setMode(mode: 'plan' | 'act'): void {
    this.mode = mode;
  }

  /** True while a turn is in flight. */
  public get isBusy(): boolean {
    return this.isProcessing;
  }

  /**
   * Aborts the in-flight turn (Ctrl-C). Returns false when nothing is running.
   *
   * Without this, a provider that stalls — or a tool loop grinding through
   * iterations — could not be interrupted: `isProcessing` rejected all further
   * input, so the session was wedged until the request eventually returned.
   */
  public cancelTurn(): boolean {
    if (!this.turnAbort) return false;
    this.turnAbort.abort(new Error('cancelled by user'));
    return true;
  }

  public setActiveModel(model: string, provider?: string): void {
    this.activeModel = model;
    if (provider && provider !== this.engine.config.provider) {
      this.engine.reconfigure({ ...this.engine.config, provider: provider as any });
    }
    if (this.io.onModelChange) {
      this.io.onModelChange(model, provider);
    }
  }

  public getStats(): ReplSessionStats {
    return { ...this.stats, filesModified: new Set(this.stats.filesModified) };
  }

  public getTurns(): SessionTurn[] {
    return [...this.turns];
  }

  public startLogoAnimation(_intervalMs = 120): void {
    // No-op: ASCII logo removed from terminal
  }

  public stopLogoAnimation(): void {
    if (this.shimmerInterval) {
      clearInterval(this.shimmerInterval);
      this.shimmerInterval = null;
    }
  }

  public printBanner(): void {
    this.stopLogoAnimation();
    const modeLabel = this.mode === 'plan' ? yellow('plan (read-only)') : green('act (asks before writes)');
    const banner = [
      '',
      `  ${c('☁️ MUGIL IDE', ANSI.bold, ANSI.brightGreen)} ${dim('— Token-Efficient Autonomous AI IDE')}`,
      `  ${dim('Model:')} ${bold(cyan(this.getActiveModel()))}  ${dim('Workspace:')} ${yellow(process.cwd())}`,
      `  ${dim('Mode:')} ${modeLabel}`,
      `  ${dim('Credited Modules:')} ${dim('Caveman (JuliusBrussee) · RTK (rtk-ai) · Ponytail (DietrichGebert) · De-AI (conorbronsdon) · Watermarks (guillaumemeyer) · CodeGraph (colbymchenry) · OpenCode (sst)')}`,
      `  ${dim('Tools:')} ${green('read, write, edit, patch, run_command, search, codegraph, todo, skill, web, lsp, question, task')}`,
      `  ${dim('Commands:')} ${cyan('/help')} ${dim('·')} ${cyan('/models')} ${dim('·')} ${cyan('/plan')} ${dim('·')} ${cyan('/act')} ${dim('·')} ${cyan('/undo')} ${dim('·')} ${cyan('/graph')} ${dim('·')} ${cyan('/stats')} ${dim('·')} ${cyan('/clear')}`,
      '',
    ].join('\r\n');
    this.io.write(banner + '\r\n');
    this.printPrompt();
  }

  public printPrompt(): void {
    const turnCount = this.turns.length + 1;
    const promptStr = `${ANSI.bold}${ANSI.brightMagenta}[Turn ${turnCount}] mugil-ide${ANSI.reset}${dim('> ')}`;
    this.io.write(promptStr);
  }

  public async handleInput(rawLine: string): Promise<void> {
    this.stopLogoAnimation();
    const line = rawLine.trim();
    if (!line) {
      this.printPrompt();
      return;
    }

    if (this.isProcessing) {
      this.io.write(`\r\n${yellow('⚠ Still processing previous prompt... please wait.')}\r\n`);
      return;
    }

    // Slash command handling
    if (line.startsWith('/')) {
      await this.handleSlashCommand(line);
      this.printPrompt();
      return;
    }

    if (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') {
      this.io.write(`\r\n${dim('Goodbye!')}\r\n`);
      if (this.io.onExit) this.io.onExit();
      return;
    }

    await this.executePrompt(line);
    this.printPrompt();
  }

  private lastListedModels: Array<ModelSpec & { provider?: string; isLocal?: boolean }> = [];

  private async handleSlashCommand(cmdLine: string): Promise<void> {
    const [command, ...args] = cmdLine.slice(1).split(/\s+/);
    const argStr = args.join(' ').trim();
    if (!command) {
      this.printHelp();
      return;
    }

    switch (command.toLowerCase()) {
      case 'help':
      case 'h':
      case '?':
        this.printHelp();
        break;

      case 'model':
      case 'm':
        if (!argStr) {
          this.io.write(`\r\n  ${dim('Current model:')} ${bold(cyan(this.getActiveModel()))} ${dim(`(${this.engine.config.provider})`)}\r\n  ${dim('Use')} ${cyan('/model <id or number>')} ${dim('or')} ${cyan('/models')} ${dim('to list.')}\r\n\r\n`);
        } else {
          let selected = argStr;
          let provider: string | undefined;
          const num = parseInt(argStr, 10);
          if (!isNaN(num) && num >= 1 && num <= this.lastListedModels.length) {
            const found = this.lastListedModels[num - 1]!;
            selected = found.id;
            provider = found.provider;
          } else {
            const found = this.lastListedModels.find((m) => m.id.toLowerCase() === selected.toLowerCase());
            if (found) {
              selected = found.id;
              provider = found.provider;
            }
          }
          if (!provider) {
            if (selected.includes('/') && !selected.startsWith('http')) {
              provider = 'openrouter';
            }
          }
          this.setActiveModel(selected, provider);
          this.io.write(`\r\n  ${green('✓')} Active model changed to: ${bold(cyan(selected))}${provider ? dim(` (${provider})`) : ''}\r\n\r\n`);
        }
        break;

      case 'models':
        await this.listModels();
        break;

      case 'plan':
        this.setMode('plan');
        saveMode('plan');
        this.io.write(`\r\n  ${yellow('🔒 Plan mode')} ${dim('— read-only: writes, edits and commands are denied.')}\r\n\r\n`);
        break;

      case 'act':
        this.setMode('act');
        saveMode('act');
        this.io.write(`\r\n  ${green('⚡ Act mode')} ${dim('— writes, edits and commands ask for your approval.')}\r\n\r\n`);
        break;

      case 'clear':
      case 'cls':
        this.io.write(ANSI.clearScreen);
        this.printBanner();
        break;

      case 'stats':
        this.printStats();
        break;

      case 'history':
        this.printHistory();
        break;

      case 'undo':
        try {
          const snapshot = undoLast(process.cwd());
          if (snapshot) {
            this.io.write(`\r\n  ${green('✓')} Reverted edit to: ${bold(snapshot.path)}\r\n\r\n`);
            this.stats.filesModified.delete(snapshot.path);
            // Keep the auto-saved session in sync with the updated stats.
            void this.saveCurrentSession();
          } else {
            this.io.write(`\r\n  ${yellow('ℹ')} Nothing to undo.\r\n\r\n`);
          }
        } catch (err) {
          this.io.write(`\r\n  ${red('✗')} Undo failed: ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
        }
        break;

      case 'graph':
        await this.queryGraph(argStr);
        break;

      case 'session':
        if (!argStr) {
          this.io.write(`\r\n  ${yellow('Usage:')} ${cyan('/session <name>')} ${dim('— save the conversation under a name')}\r\n\r\n`);
          break;
        }
        try {
          const file = await this.saveCurrentSession(namedSessionPath(argStr));
          this.io.write(`\r\n  ${green('✓')} Session saved as ${bold(argStr)} → ${dim(file)}\r\n\r\n`);
        } catch (err) {
          this.io.write(`\r\n  ${red('✗')} Save failed: ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
        }
        break;

      case 'sessions':
        this.listSavedSessions();
        break;

      case 'resume':
        if (!argStr) {
          this.io.write(`\r\n  ${yellow('Usage:')} ${cyan('/resume <name>')} ${dim('— load a named session')}\r\n\r\n`);
          break;
        }
        {
          const resumed = loadSessionFile(namedSessionPath(argStr));
          if (resumed.entries.length === 0) {
            this.io.write(`\r\n  ${yellow('ℹ')} No saved session named ${bold(argStr)}. Try ${cyan('/sessions')}.\r\n\r\n`);
            break;
          }
          this.restoreSessionEntries(resumed.entries);
          this.restoreSessionStats(resumed.stats);
          this.io.write(`\r\n  ${green('✓')} Resumed session ${bold(argStr)} (${resumed.entries.length} turns).\r\n\r\n`);
        }
        break;

      case 'clear-session':
        clearSession();
        this.io.write(`\r\n  ${green('✓')} Cleared the auto-saved session — the next launch starts fresh.\r\n\r\n`);
        break;

      case 'compact':
        await this.compactConversation();
        break;

      case 'reset':
        this.messageHistory = [];
        this.turns = [];
        this.stats = AgentRepl.defaultStats();
        // Also clear the auto-saved session file so a later launch doesn't
        // resurrect the reset conversation (or its stats).
        clearSession();
        this.io.write(`\r\n  ${green('✓')} Conversation context reset — the next launch starts fresh.\r\n\r\n`);
        break;

      case 'exit':
      case 'quit':
      case 'q':
        this.io.write(`\r\n${dim('Goodbye!')}\r\n`);
        if (this.io.onExit) this.io.onExit();
        break;

      default:
        this.io.write(`\r\n  ${red('✗')} Unknown command: ${bold('/' + command)}. Type ${cyan('/help')} for command list.\r\n\r\n`);
        break;
    }
  }

  private printHelp(): void {
    const lines = [
      '',
      `  ${bold('Mugil IDE Slash Commands:')}`,
      `  ${cyan('/models')}               ${dim('List available local (Ollama/LM Studio) and cloud models')}`,
      `  ${cyan('/model <name|number>')}   ${dim('Switch active model (e.g. /model 1 or /model llama3.2)')}`,
      `  ${cyan('/plan')}                 ${dim('Plan mode — read-only: writes/edits/commands denied')}`,
      `  ${cyan('/act')}                  ${dim('Act mode — asks before writes/edits/commands')}`,
      `  ${cyan('/compact')}              ${dim('Summarize the conversation so far and continue from the summary')}`,
      `  ${cyan('/session <name>')}       ${dim('Save the conversation under a name')}`,
      `  ${cyan('/sessions')}             ${dim('List saved named sessions')}`,
      `  ${cyan('/resume <name>')}        ${dim('Load a named session')}`,
      `  ${cyan('/clear-session')}        ${dim('Clear the auto-saved session')}`,
      `  ${cyan('/stats')}                ${dim('Display token savings and session metrics')}`,
      `  ${cyan('/graph <query>')}        ${dim('Search project code graph for relevant functions/symbols')}`,
      `  ${cyan('/undo')}                 ${dim('Undo last file change made by tool execution')}`,
      `  ${cyan('/history')}              ${dim('View prompt history in current session')}`,
      `  ${cyan('/reset')}                ${dim('Clear conversation context history')}`,
      `  ${cyan('/clear')}                ${dim('Clear terminal screen')}`,
      `  ${cyan('/exit')}                 ${dim('Exit Mugil IDE')}`,
      '',
    ];
    this.io.write(lines.join('\r\n'));
  }

  private async listModels(): Promise<void> {
    this.io.write(`\r\n  ${dim('Scanning for models (local Ollama, LM Studio, and configured providers)...')}\r\n`);
    try {
      const allFound: Array<ModelSpec & { provider?: string; isLocal?: boolean }> = [];
      // 1. Local Ollama
      try {
        const ollama = await fetchProviderModels({
          provider: 'ollama',
          baseUrl: process.env.OLLAMA_BASE_URL || this.engine.config.ollamaBaseUrl || 'http://localhost:11434/v1',
          timeoutMs: 1500,
        });
        if (ollama && ollama.length > 0) {
          ollama.forEach((m) => allFound.push({ ...m, provider: 'ollama', isLocal: true }));
        }
      } catch {
        // ignore — Ollama not reachable, continue to other providers
      }

      // 2. Local LM Studio
      try {
        const lm = await fetchProviderModels({
          provider: 'lmstudio',
          baseUrl: process.env.LMSTUDIO_BASE_URL || this.engine.config.lmstudioBaseUrl || 'http://localhost:1234/v1',
          timeoutMs: 1500,
        });
        if (lm && lm.length > 0) {
          lm.forEach((m) => allFound.push({ ...m, provider: 'lmstudio', isLocal: true }));
        }
      } catch {
        // ignore — LM Studio not reachable, continue to other providers
      }

      // 3. Probe every cloud provider with a configured key (parity with the
      // web UI /api/models endpoint) so no provider's models are hidden.
      const env = readUserEnv();
      const keyFor = (names: string[]): string | undefined => {
        for (const n of names) {
          const k = process.env[n] || env[n];
          if (k) return k;
        }
        return undefined;
      };
      const cloudTargets: Array<{
        provider: 'openrouter' | 'openai' | 'anthropic' | 'vercel' | 'cloudflare' | 'together' | 'opencode';
        label: string;
        apiKey?: string;
        baseUrl?: string;
      }> = [
        { provider: 'openrouter', label: 'OpenRouter', apiKey: keyFor(['OPENROUTER_API_KEY']), baseUrl: this.engine.config.openRouterBaseUrl },
        { provider: 'openai', label: 'OpenAI', apiKey: keyFor(['OPENAI_API_KEY']), baseUrl: this.engine.config.openaiBaseUrl },
        { provider: 'anthropic', label: 'Anthropic', apiKey: keyFor(['ANTHROPIC_API_KEY']), baseUrl: this.engine.config.anthropicBaseUrl },
        { provider: 'vercel', label: 'Vercel AI', apiKey: keyFor(['VERCEL_API_KEY']), baseUrl: this.engine.config.vercelBaseUrl },
        { provider: 'cloudflare', label: 'Cloudflare', apiKey: keyFor(['CLOUDFLARE_API_KEY']), baseUrl: this.engine.config.cloudflareBaseUrl },
        { provider: 'together', label: 'Together AI', apiKey: keyFor(['TOGETHER_API_KEY']), baseUrl: this.engine.config.togetherBaseUrl },
        { provider: 'opencode', label: 'OpenCode Zen', apiKey: keyFor(['OPENCODE_API_KEY']), baseUrl: this.engine.config.opencodeBaseUrl },
      ];
      for (const target of cloudTargets) {
        if (!target.apiKey && target.provider !== 'openrouter') continue;
        try {
          const found = await fetchProviderModels({
            provider: target.provider,
            apiKey: target.apiKey,
            baseUrl: target.baseUrl,
            timeoutMs: 3000,
          });
          if (found && found.length > 0) {
            found.forEach((m) => allFound.push({ ...m, provider: target.provider, isLocal: false }));
          }
        } catch {
          // ignore — provider probe failed (missing key / network), continue
        }
      }

      this.lastListedModels = allFound;

      if (this.lastListedModels.length === 0) {
        this.io.write(`\r\n  ${yellow('⚠ No active local or cloud models found.')}\r\n`);
        this.io.write(`  ${dim('Add a key in the web UI')} ${cyan('Accounts & Keys')} ${dim('modal (or set it in')} ${cyan('~/.config/mugil-ide/.env')}${dim('), or start a local Ollama / LM Studio instance.')}\r\n\r\n`);
        return;
      }

      this.io.write(`\r\n  ${bold('Available Models (' + this.lastListedModels.length + ' found):')}\r\n`);
      for (let i = 0; i < Math.min(this.lastListedModels.length, 30); i++) {
        const m = this.lastListedModels[i]!;
        const num = `[${i + 1}]`.padEnd(4);
        const isCurrent = m.id === this.getActiveModel();
        const indicator = isCurrent ? green('●') : dim('○');
        const tools = m.supportsTools ? cyan('[tools]') : '';
        const think = m.supportsThinking ? magenta('[think]') : '';
        const prov = m.provider ? dim(`[${m.provider}]`) : '';
        this.io.write(`  ${cyan(num)} ${indicator} ${bold(m.id.padEnd(35))} ${prov.padEnd(14)} ${dim(m.tier.padEnd(8))} ${tools} ${think}\r\n`);
      }
      this.io.write(`\r\n  ${dim('Type')} ${cyan('/model <number>')} ${dim('(e.g. /model 1) or')} ${cyan('/model <id>')} ${dim('to select.')}\r\n\r\n`);
    } catch (err) {
      this.io.write(`  ${yellow('⚠ Could not probe models dynamically:')} ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
    }
  }

  private printStats(): void {
    const s = this.stats;
    const savingsPct = s.promptTokens + s.tokensSaved > 0
      ? Math.round((s.tokensSaved / (s.promptTokens + s.tokensSaved)) * 100)
      : 0;
    const cm = this.engine.cache?.getMetrics?.();

    const lines = [
      '',
      `  ${bold('Session Token Efficiency Stats:')}`,
      `  ${dim('Requests / Turns:')}   ${bold(s.requests)}`,
      `  ${dim('Prompt Tokens:')}      ${cyan(s.promptTokens)}`,
      `  ${dim('Completion Tokens:')}  ${magenta(s.completionTokens)}`,
      `  ${dim('Total Tokens Used:')}  ${bold(s.totalTokens)}`,
      `  ${dim('Tokens Saved:')}       ${green(s.tokensSaved)} ${green(`(${savingsPct}% reduction)`)}`,
      `  ${dim('Smart Cache Hits:')}   ${yellow(s.cacheHits)}${cm ? dim(` (lookups: ${cm.lookups}, hit rate: ${cm.hitRatePct}%)`) : ''}`,
      `  ${dim('Files Modified:')}     ${cyan(s.filesModified.size)} ${dim(Array.from(s.filesModified).join(', ') || '(none)')}`,
      '',
    ];
    this.io.write(lines.join('\r\n'));
  }

  private printHistory(): void {
    if (this.turns.length === 0) {
      this.io.write(`\r\n  ${dim('No prompt history yet.')}\r\n\r\n`);
      return;
    }
    this.io.write(`\r\n  ${bold('Session Conversation Turns:')}\r\n`);
    this.turns.forEach((t) => {
      const timeStr = new Date(t.timestamp).toLocaleTimeString();
      this.io.write(`  ${bold(cyan(`[Turn ${t.id}]`))} ${dim(timeStr)} ${bold(t.prompt.slice(0, 50))}\r\n`);
      this.io.write(`      ${dim(`Model: ${t.model} · Tokens: ${t.tokens.total} · Tools: ${t.toolsCalled.length}`)}\r\n`);
      if (t.filesModified.length > 0) {
        this.io.write(`      ${green(`Modified: ${t.filesModified.join(', ')}`)}\r\n`);
      }
    });
    this.io.write('\r\n');
  }

  private listSavedSessions(): void {
    const infos = listSessions();
    if (infos.length === 0) {
      this.io.write(`\r\n  ${dim('No saved named sessions yet — use')} ${cyan('/session <name>')} ${dim('to save one.')}\r\n\r\n`);
      return;
    }
    this.io.write(`\r\n  ${bold('Saved Sessions:')}\r\n`);
    for (const info of infos) {
      const time = new Date(info.savedAt).toLocaleString();
      this.io.write(`  ${cyan(info.name)} ${dim(`· ${info.turns} turns · ${time}`)}\r\n`);
    }
    this.io.write(`  ${dim('Resume one with')} ${cyan('/resume <name>')}.\r\n\r\n`);
  }

  /** Summarizes the conversation and replaces the history with the summary. */
  private async compactConversation(): Promise<void> {
    if (this.turns.length === 0) {
      this.io.write(`\r\n  ${dim('Nothing to compact yet — no completed turns.')}\r\n\r\n`);
      return;
    }
    const turns: ConversationTurn[] = this.turns.map((t) => ({ prompt: t.prompt, response: t.response }));
    const rendered = renderConversationForSummary(turns);
    this.io.write(`\r\n  ${dim('⚡ Summarizing conversation...')}\r\n`);
    try {
      const result = await this.engine.pipeline.ask(
        'Summarize the conversation below. Keep it dense: preserve decisions, file changes, tool outcomes, and any unfinished work.',
        {
          preferredModel: this.getActiveModel(),
          systemPrompt: 'You are a conversation compactor. Output only the summary, with no preamble.',
          ponytail: { outputBudget: 1200 },
          history: [{ role: 'user', content: rendered }],
        },
      );
      const summary = result.response.trim();
      const turnCount = this.turns.length;
      this.messageHistory = [
        { role: 'user', content: `[Conversation compacted — earlier turns summarized]\n${summary}` },
        { role: 'assistant', content: '[acknowledged]' },
      ];
      this.io.write(`  ${green('✓')} Conversation compacted (${turnCount} turns → summary).\r\n\r\n`);
    } catch (err) {
      this.io.write(`\r\n  ${red('✗')} Compaction failed: ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
    }
  }

  private async queryGraph(query: string): Promise<void> {
    if (!query) {
      this.io.write(`\r\n  ${yellow('Usage:')} ${cyan('/graph <query text>')}\r\n\r\n`);
      return;
    }
    try {
      const graph = buildCodeGraph(process.cwd());
      const results = queryCodeGraph(graph, query, { top: 6 });
      this.io.write(`\r\n  ${bold(`CodeGraph Results for "${query}":`)}\r\n`);
      if (results.length === 0) {
        this.io.write(`  ${dim('No matching symbols found.')}\r\n\r\n`);
        return;
      }
      for (const r of results) {
        this.io.write(`  ${green(`[score ${r.score}]`)} ${bold(r.symbol.file)}:${cyan(r.symbol.line)} ${dim(r.symbol.signature)}\r\n`);
      }
      this.io.write('\r\n');
    } catch (err) {
      this.io.write(`\r\n  ${red('✗')} CodeGraph query failed: ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
    }
  }

  /**
   * Builds the allow/ask/deny gate for the current mode, layered with any
   * persisted per-mode overrides from `MUGIL_IDE_TOOL_PERMISSIONS` (user env
   * file wins over process env). Without an `onAsk` handler, `ask` actions
   * are treated as denied so headless callers never auto-approve.
   */
  private buildPermissionCheck(): PermissionCheck {
    let policy = defaultPolicyForMode(this.mode);
    const raw = readUserEnv().MUGIL_IDE_TOOL_PERMISSIONS || process.env.MUGIL_IDE_TOOL_PERMISSIONS || '';
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Record<string, Record<string, ToolPermissionAction>>;
        const overrides = parsed[this.mode];
        if (overrides && typeof overrides === 'object') {
          policy = applyPermissionOverrides(policy, overrides);
        }
      } catch {
        // malformed overrides — fall back to the mode defaults
      }
    }
    return createPermissionCheck(policy, this.options.onAsk);
  }

  /**
   * Lazily connects configured MCP servers (once per session) and merges
   * their `mcp__<server>__<tool>` tools into the loop. Failures are soft:
   * the server is skipped, a warning is surfaced, and the turn proceeds.
   */
  private async getMcpTools(): Promise<McpToolsBundle> {
    if (!this.mcpConnecting) {
      this.mcpConnecting = (async () => {
        const configs = parseMcpServerConfigs();
        if (configs.length === 0) {
          return { tools: [], registry: {}, errors: [], servers: [], close: async () => {} };
        }
        const bundle = await connectMcpServers(configs);
        for (const err of bundle.errors) {
          this.io.write(`  ${yellow('⚠')} ${dim(err)}\r\n`);
        }
        if (bundle.servers.length > 0) {
          this.io.write(`  ${dim(`MCP servers connected: ${bundle.servers.join(', ')} (${bundle.tools.length} tools)`)}`);
          this.io.write(`  ${dim('— mcp__* tools are ask-gated in act mode, denied in plan mode.')}\r\n`);
        }
        return bundle;
      })().catch((err: unknown) => {
        this.mcpConnecting = null; // allow a later turn to retry
        this.io.write(`  ${yellow('⚠ MCP connection failed:')} ${err instanceof Error ? err.message : String(err)}\r\n`);
        return { tools: [], registry: {}, errors: [], servers: [], close: async () => {} };
      });
    }
    return this.mcpConnecting;
  }

  /** Current conversation as persisted session entries (newest last). */
  private sessionEntries(): SessionEntry[] {
    return this.turns.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      response: t.response,
      model: t.model,
      toolCalls: t.toolsCalled.length,
    }));
  }

  private async saveCurrentSession(file?: string): Promise<string> {
    const entries = this.sessionEntries();
    if (entries.length === 0) return '';
    return saveSession(entries, file, this.statsToSession());
  }

  /** Session metrics in the JSON-friendly shape persisted with the session. */
  private statsToSession(): SessionStats {
    return { ...this.stats, filesModified: Array.from(this.stats.filesModified) };
  }

  /** Restores persisted session metrics (no-op when the file had none). */
  private restoreSessionStats(stats: SessionStats | null): void {
    if (!stats) return;
    this.stats = { ...stats, filesModified: new Set(stats.filesModified) };
  }

  /** Rebuilds message history + turn list from persisted entries. */
  private restoreSessionEntries(entries: SessionEntry[]): void {
    if (!entries || entries.length === 0) return;
    this.messageHistory = [];
    this.turns = [];
    let nextId = 1;
    for (const e of entries) {
      this.messageHistory.push({ role: 'user', content: e.prompt });
      this.messageHistory.push({ role: 'assistant', content: e.response });
      this.turns.push({
        id: nextId++,
        prompt: e.prompt,
        response: e.response,
        model: e.model ?? 'unknown',
        timestamp: 0,
        tokens: { prompt: 0, completion: 0, total: 0, saved: 0 },
        toolsCalled: [],
        filesModified: [],
      });
    }
    if (this.messageHistory.length > 20) {
      this.messageHistory = this.messageHistory.slice(-20);
    }
  }

  private async executePrompt(prompt: string): Promise<void> {
    this.isProcessing = true;
    this.turnAbort = new AbortController();
    const started = Date.now();
    const currentTurnId = this.turns.length + 1;
    const toolsCalled: SessionTurn['toolsCalled'] = [];
    const filesModifiedThisTurn: string[] = [];

    // Streaming render state. Only a delta flagged `streamed: true` — a
    // fragment that really arrived incrementally over SSE — takes the live
    // path. The buffered fallback (stream:false, no client.stream(),
    // MUGIL_IDE_NO_STREAM=1) emits ONE delta carrying the whole answer, and
    // it is ignored here so the kill switch renders byte-for-byte what it
    // rendered before streaming existed: `formatMarkdown(result.response)`.
    // `streamed` is the text currently in the answer region — the completion
    // in flight, not the turn — so it resets when a tool call proves a new
    // completion has begun. Declared outside the try so the cancellation
    // handler can see what was left on screen.
    let streamed = '';
    let streamedRegion = false;

    this.io.write('\r\n' + `${ANSI.bold}${ANSI.cyan}` + '─'.repeat(64) + `${ANSI.reset}\r\n`);
    this.io.write(`  ${bold(cyan(`Turn #${currentTurnId}`))} ${dim('— Thinking & Planning...')}\r\n`);

    try {
      // Wire up workspace tools so model can read, write, edit, and run commands on disk.
      // handoff powers the `task` subagent tool; onQuestion powers the `question` tool;
      // subagents share the same permission gate as the main loop.
      const permission = this.buildPermissionCheck();
      const workspace = createWorkspaceTools(process.cwd(), {
        handoff: this.engine.handoff,
        onQuestion: this.options.onQuestion,
        subagentPermission: permission,
        // Ctrl-C must stop a running subagent, not just the parent turn.
        signal: this.turnAbort.signal,
        diagnostics: diagnosticsEnabledFromEnv(),
        onSubagentTool: (mode, call) => {
          const args = (() => {
            try {
              const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
              return parsed.description ? `: ${String(parsed.description).slice(0, 60)}` : '';
            } catch {
              return '';
            }
          })();
          this.io.write(`  ${dim(`└ [subagent·${mode}] ${call.name}`)}${args}\r\n`);
        },
      });
      // MCP client: merge configured servers' tools into the loop (soft failures).
      const mcp = await this.getMcpTools();
      const allTools = [...workspace.tools, ...mcp.tools];
      const allRegistry = { ...workspace.toolRegistry, ...mcp.registry };

      // Prepare token-budgeted conversation history (MUGIL_IDE_HISTORY_BUDGET, default 16,000 tokens)
      const turnsForBudget: ConversationTurn[] = [];
      for (let i = 0; i < this.messageHistory.length; i += 2) {
        const u = this.messageHistory[i];
        const a = this.messageHistory[i + 1];
        if (u && a) {
          turnsForBudget.push({ prompt: u.content, response: a.content });
        }
      }
      const historyBudget = getHistoryBudget();
      const budgeted = budgetConversationHistory(turnsForBudget, historyBudget, { compactOlderTurns: true });
      // Only count history savings for turns that actually fell out of the
      // window *this* turn. The old figure (raw total - budgeted total)
      // re-counted the same trimmed history on every single turn, so
      // tokensSaved grew quadratically and bore no relation to real spend.
      let historyTokensSaved = 0;
      for (let i = 0; i < budgeted.droppedCount && i < turnsForBudget.length; i += 1) {
        const t = turnsForBudget[i]!;
        historyTokensSaved += countTokens(t.prompt) + countTokens(t.response);
      }
      const budgetedHistory: ChatMessage[] = [];
      for (const t of budgeted.turns) {
        budgetedHistory.push({ role: 'user', content: t.prompt });
        budgetedHistory.push({ role: 'assistant', content: t.response });
      }

      const agentInstruction =
        this.mode === 'plan'
          ? PLAN_MODE_INSTRUCTION
          : ACT_MODE_INSTRUCTION;
      const contextBlocks = [agentInstruction, buildEnvironmentContext(process.cwd()), skillsContextBlock(process.cwd())]
        .filter((b) => b.trim().length > 0)
        .join('\n\n');

      const result = await this.engine.pipeline.ask(prompt, {
        preferredModel: this.getActiveModel(),
        history: budgetedHistory,
        systemPrompt: contextBlocks,
        tools: allTools,
        toolRegistry: allRegistry,
        permission,
        maxToolIterations: 15,
        ponytail: true,
        signal: this.turnAbort.signal,
        onEvent: (event: PipelineEvent) => {
          if (event.type === 'stage') {
            if (event.stage === 'refine') {
              this.io.write(`  ${dim('⚡ Refining prompt tokens...')}\r\n`);
            } else if (event.stage === 'handoff') {
              this.io.write(`  ${dim('⚡ Requesting model...')}\r\n`);
            }
          } else if (event.type === 'refined') {
            if (event.refine.savingsPct > 0) {
              this.io.write(
                `  ${green('✓')} Token Refinement: ${event.refine.originalTokens} → ${event.refine.refinedTokens} tok ${green(`(-${event.refine.savingsPct}%)`)} [${event.refine.appliedStrategies.join(', ')}]\r\n`,
              );
            }
            if (event.refine.truncated) {
              // The model only saw the kept prefix — it is answering a shorter
              // question than the one asked. Say so rather than letting the
              // user wonder why the answer ignores the end of their input.
              this.io.write(
                `  ${yellow('⚠ Prompt truncated')} ${dim(`(${event.refine.truncatedTokens} tokens of your input were dropped to fit the budget — the tail was NOT sent.)`)}\r\n`,
              );
            }
          } else if (event.type === 'tool') {
            // This completion asked for tools, so what it streamed was the model
            // narrating intent, not the answer. Say so, then start the next
            // completion's region clean so the two cannot splice together.
            if (streamed.trim().length > 0) {
              this.io.write(`\r\n  ${yellow('⚠ Partial reasoning discarded — the model requested tools.')}\r\n`);
              streamed = '';
            }
            const argsObj = event.args ? (typeof event.args === 'string' ? JSON.parse(event.args) : event.args) : {};
            toolsCalled.push({ name: event.name, args: argsObj });

            // Record modified files
            if (event.name === 'write_file' || event.name === 'edit_file' || event.name === 'apply_patch') {
              const targetPath = argsObj.path || argsObj.file;
              if (targetPath) {
                filesModifiedThisTurn.push(targetPath);
                this.stats.filesModified.add(targetPath);
              }
            }

            const argSummary = argsObj.path
              ? `path: "${argsObj.path}"`
              : argsObj.command
                ? `cmd: "${argsObj.command}"`
                : JSON.stringify(argsObj).slice(0, 60);

            this.io.write(`\r\n  ${yellow('⚡ Tool Call:')} ${bold(yellow(event.name))}(${argSummary})\r\n`);
          } else if (event.type === 'tool-result') {
            const last = toolsCalled[toolsCalled.length - 1];
            if (last) {
              last.ok = event.ok;
              last.result = event.result;
            }
            if (event.ok) {
              const snippet = event.result ? event.result.split('\n')[0]?.slice(0, 80) : 'success';
              this.io.write(`  ${green('✓')} Tool Result: ${dim(snippet || 'done')}\r\n`);
            } else {
              this.io.write(`  ${red('✗')} Tool Error: ${red(event.result || 'failed')}\r\n`);
            }
          } else if (event.type === 'delta') {
            // A buffered whole-answer replay is not live output: ignore it, so
            // the formatted answer is printed below exactly as it was before
            // streaming existed.
            if (event.streamed) {
              if (!streamedRegion) {
                // First fragment: take over the blank line under the header.
                streamedRegion = true;
                this.io.write(`\r\n${bold(cyan('Assistant:'))}\r\n`);
              }
              streamed += event.text;
              // Raw fragments carry bare `\n`, which steps down a line without
              // returning the carriage in both the terminal and xterm, so text
              // would staircase. Normalising each fragment on its own is
              // stateless — but a `\r` ending one fragment and a `\n` starting
              // the next becomes `\r\r\n` and leaves a blank line. Fixing that
              // needs cross-fragment state, which streaming exists to avoid, so
              // a split at the boundary is the accepted cost.
              this.io.write(event.text.replace(/\r?\n/g, '\r\n'));
            }
          }
        },
      });

      const elapsed = Date.now() - started;

      // Update statistics
      this.stats.requests++;
      this.stats.promptTokens += result.usage.promptTokens;
      this.stats.completionTokens += result.usage.completionTokens;
      this.stats.totalTokens += result.usage.totalTokens;
      if (result.cache.hit) this.stats.cacheHits++;
      const promptSaved = Math.max(0, result.refine.originalTokens - result.refine.refinedTokens);
      const cacheSaved = result.cache.hit ? result.usage.totalTokens : 0;
      const turnTokensSaved = promptSaved + historyTokensSaved + cacheSaved;
      this.stats.tokensSaved += turnTokensSaved;

      // Add to multi-turn memory
      this.messageHistory.push({ role: 'user', content: prompt });
      this.messageHistory.push({ role: 'assistant', content: result.response });

      // Cap conversation history to prevent blowing token budget (OpenCode trim pattern)
      if (this.messageHistory.length > 20) {
        this.messageHistory = this.messageHistory.slice(-20);
      }

      // Thinking reasoning block if present. Suppressed when that exact text is
      // already in the streamed region: a DeepSeek-R1 style model inlines its
      // reasoning in the answer, so the fragments printed it verbatim and the
      // block would be a literal duplicate of what is already on screen.
      const thinking = result.thinking?.trim() ?? '';
      const alreadyOnScreen = thinking.length > 0 && streamed.includes(thinking);
      if (result.thinking && !alreadyOnScreen) {
        this.io.write(`\r\n${magenta('💭 Reasoning / Thinking:')}\r\n`);
        const formattedThinking = result.thinking
          .split('\n')
          .map((l) => `  ${dim(l)}`)
          .join('\r\n');
        this.io.write(`${formattedThinking}\r\n`);
      }

      // Exactly one of the two paths below prints the answer. `streamed` holds only
      // fragments that arrived incrementally, so a non-empty `streamed` means
      // the region on screen IS the final answer; otherwise nothing was live
      // (buffered replay, kill switch) and the formatted text is the only copy.
      const streamedIsAnswer = streamed.trim().length > 0;
      if (streamedIsAnswer && streamed.trim() !== result.response.trim()) {
        // Post-processing runs on the AGGREGATE, long after the fragments are on
        // screen: a DeepSeek-R1 `<think>` block and an AI watermark are only
        // lifted from the aggregate, and a partial cache hit prefixes what the
        // cache already had. Say the screen and the store diverged — but do NOT
        // reprint the answer, which would duplicate it on screen.
        this.io.write(
          `\r\n  ${yellow('⚠ Streamed text is not what was stored')}${dim(' — post-processing (think blocks / watermarks) rewrote the answer; history, the session file and the cache hold the cleaned text.')}\r\n`,
        );
      }

      // Assistant Response (the header is already on screen if anything streamed)
      if (!streamedRegion) {
        this.io.write(`\r\n${bold(cyan('Assistant:'))}\r\n`);
      }
      if (!streamedIsAnswer) {
        this.io.write(`${formatMarkdown(result.response)}\r\n`);
      } else {
        // Start a fresh line so the footer never lands on the last streamed one.
        this.io.write('\r\n');
      }

      // Summary of changes applied to disk
      if (filesModifiedThisTurn.length > 0) {
        this.io.write(`\r\n  ${green('📁 Files updated on disk:')} ${bold(filesModifiedThisTurn.join(', '))}\r\n`);
      }

      // Turn Footer
      this.io.write(`\r\n${dim(`[${result.model} · ${result.usage.totalTokens} tok · ${elapsed}ms · ${toolsCalled.length} tools]`)}\r\n`);
      if (result.truncated) {
        this.io.write(
          `  ${yellow('⚠ Answer was cut off by the model output-token cap')} ${dim(`(finish_reason: ${result.finishReason}) — raise max_tokens or shorten the task.`)}\r\n`,
        );
      }
      this.io.write(`${ANSI.bold}${ANSI.cyan}` + '─'.repeat(64) + `${ANSI.reset}\r\n\r\n`);

      const turnObj: SessionTurn = {
        id: currentTurnId,
        prompt,
        response: result.response,
        model: result.model,
        timestamp: Date.now(),
        tokens: {
          prompt: result.usage.promptTokens,
          completion: result.usage.completionTokens,
          total: result.usage.totalTokens,
          saved: turnTokensSaved,
        },
        toolsCalled,
        filesModified: filesModifiedThisTurn,
      };

      this.turns.push(turnObj);
      if (this.io.onTurnComplete) {
        this.io.onTurnComplete(turnObj);
      }
      // Auto-save the conversation for next-launch resume (fire-and-forget).
      void this.saveCurrentSession();
    } catch (err) {
      // A user cancel is not a failure: report it as such and keep the session
      // usable. Anything else is a real error worth surfacing.
      if (this.turnAbort?.signal.aborted) {
        // A partial answer is already on screen. Without a marker it reads like
        // a finished one — and it was never stored: nothing below the try ever
        // ran, so history, the session file and the cache do not have it.
        if (streamedRegion && streamed.trim().length > 0) {
          this.io.write(`\r\n  ${yellow('■ Turn cancelled.')} ${dim('The streamed text is an incomplete answer — it was NOT saved to history or the session file.')}\r\n`);
        } else {
          this.io.write(`\r\n${yellow('■ Turn cancelled.')}\r\n\r\n`);
        }
      } else {
        this.io.write(`\r\n${red('✗ Error executing request:')} ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
      }
    } finally {
      this.turnAbort = null;
      this.isProcessing = false;
    }
  }
}
