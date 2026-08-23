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
  countTokens,
  getColoredBanner,
  buildEnvironmentContext,
  createPermissionCheck,
  defaultPolicyForMode,
  applyPermissionOverrides,
  diagnosticsEnabledFromEnv,
  readUserEnv,
  writeUserEnv,
  connectMcpServers,
  parseMcpServerConfigs,
  skillsContextBlock,
  renderConversationForSummary,
  saveSession,
  loadSessionFile,
  listSessions,
  clearSession,
  namedSessionPath,
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
    // Restore persisted mode (default: 'act').
    const savedMode = process.env.MUGIL_IDE_MODE || readUserEnv().MUGIL_IDE_MODE;
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

  public startLogoAnimation(intervalMs = 120): void {
    if (this.shimmerInterval) return;
    this.shimmerInterval = setInterval(() => {
      // Idle-screen shimmer: keep cycling until the agent actually starts
      // working. Submitting a prompt already stops it via handleInput, and
      // processing stops it here. Resumed sessions (turns restored from the
      // auto-saved last-session) must NOT kill it — the logo stays animated
      // on the idle screen until the user interacts.
      if (this.isProcessing) {
        this.stopLogoAnimation();
        return;
      }
      this.shimmerHue = (this.shimmerHue + 8) % 360;
      const rows = getColoredBanner(this.shimmerHue).split('\n');
      let buf = '\x1b[s\x1b[?25l';
      for (let r = 0; r < rows.length; r++) {
        buf += `\x1b[${r + 2};3H${rows[r]}`;
      }
      buf += '\x1b[?25h\x1b[u';
      this.io.write(buf);
    }, intervalMs);
    if (this.shimmerInterval && typeof this.shimmerInterval.unref === 'function') {
      this.shimmerInterval.unref();
    }
  }

  public stopLogoAnimation(): void {
    if (this.shimmerInterval) {
      clearInterval(this.shimmerInterval);
      this.shimmerInterval = null;
    }
  }

  public printBanner(): void {
    this.stopLogoAnimation();
    const coloredLogo = getColoredBanner(this.shimmerHue)
      .split('\n')
      .map((line) => '  ' + line)
      .join('\r\n');
    const modeLabel = this.mode === 'plan' ? yellow('plan (read-only)') : green('act (asks before writes)');
    const banner = [
      '',
      coloredLogo,
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
    this.startLogoAnimation();
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
        try { writeUserEnv({ MUGIL_IDE_MODE: 'plan' }); } catch { /* best-effort */ }
        this.io.write(`\r\n  ${yellow('🔒 Plan mode')} ${dim('— writes, edits and commands are denied outright.')}\r\n\r\n`);
        break;

      case 'act':
        this.setMode('act');
        try { writeUserEnv({ MUGIL_IDE_MODE: 'act' }); } catch { /* best-effort */ }
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

      // 3. Configured cloud provider
      const cloudProvider = this.engine.config.provider === 'ollama' || this.engine.config.provider === 'lmstudio' ? 'openrouter' : this.engine.config.provider;
      try {
        const cloud = await fetchProviderModels({
          provider: cloudProvider,
          apiKey: this.engine.config.openRouterApiKey || this.engine.config.openaiApiKey || this.engine.config.anthropicApiKey || this.engine.config.vercelApiKey || this.engine.config.cloudflareApiKey || this.engine.config.togetherApiKey || this.engine.config.opencodeApiKey,
          baseUrl: this.engine.config.openRouterBaseUrl || this.engine.config.openaiBaseUrl || this.engine.config.anthropicBaseUrl || this.engine.config.vercelBaseUrl || this.engine.config.cloudflareBaseUrl || this.engine.config.togetherBaseUrl || this.engine.config.opencodeBaseUrl,
          timeoutMs: 3000,
        });
        if (cloud && cloud.length > 0) {
          cloud.forEach((m) => allFound.push({ ...m, provider: cloudProvider, isLocal: false }));
        }
      } catch {
        // ignore — cloud probe failed (missing key / network), continue
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

    const lines = [
      '',
      `  ${bold('Session Token Efficiency Stats:')}`,
      `  ${dim('Requests / Turns:')}   ${bold(s.requests)}`,
      `  ${dim('Prompt Tokens:')}      ${cyan(s.promptTokens)}`,
      `  ${dim('Completion Tokens:')}  ${magenta(s.completionTokens)}`,
      `  ${dim('Total Tokens Used:')}  ${bold(s.totalTokens)}`,
      `  ${dim('Tokens Saved:')}       ${green(s.tokensSaved)} ${green(`(${savingsPct}% reduction)`)}`,
      `  ${dim('Smart Cache Hits:')}   ${yellow(s.cacheHits)}`,
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
    const started = Date.now();
    const currentTurnId = this.turns.length + 1;
    const toolsCalled: SessionTurn['toolsCalled'] = [];
    const filesModifiedThisTurn: string[] = [];

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

      // Prepare token-budgeted conversation history (max 3000 tokens of history to prevent token waste)
      const turnsForBudget: ConversationTurn[] = [];
      let totalRawHistoryTokens = 0;
      for (let i = 0; i < this.messageHistory.length; i += 2) {
        const u = this.messageHistory[i];
        const a = this.messageHistory[i + 1];
        if (u && a) {
          turnsForBudget.push({ prompt: u.content, response: a.content });
          totalRawHistoryTokens += countTokens(u.content) + countTokens(a.content);
        }
      }
      const budgeted = budgetConversationHistory(turnsForBudget, 3000);
      const historyTokensSaved = Math.max(0, totalRawHistoryTokens - budgeted.tokens);
      const budgetedHistory: ChatMessage[] = [];
      for (const t of budgeted.turns) {
        budgetedHistory.push({ role: 'user', content: t.prompt });
        budgetedHistory.push({ role: 'assistant', content: t.response });
      }

      const contextBlocks = [buildEnvironmentContext(process.cwd()), skillsContextBlock(process.cwd())]
        .filter((b) => b.trim().length > 0)
        .join('\n\n');
      const result = await this.engine.pipeline.ask(prompt, {
        preferredModel: this.getActiveModel(),
        history: budgetedHistory,
        systemPrompt: contextBlocks,
        tools: allTools,
        toolRegistry: allRegistry,
        permission,
        maxToolIterations: 8,
        ponytail: true,
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
          } else if (event.type === 'tool') {
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

      // Thinking reasoning block if present
      if (result.thinking) {
        this.io.write(`\r\n${magenta('💭 Reasoning / Thinking:')}\r\n`);
        const formattedThinking = result.thinking
          .split('\n')
          .map((l) => `  ${dim(l)}`)
          .join('\r\n');
        this.io.write(`${formattedThinking}\r\n`);
      }

      // Assistant Response
      this.io.write(`\r\n${bold(cyan('Assistant:'))}\r\n`);
      const polishedResponse = formatMarkdown(result.response);
      this.io.write(`${polishedResponse}\r\n`);

      // Summary of changes applied to disk
      if (filesModifiedThisTurn.length > 0) {
        this.io.write(`\r\n  ${green('📁 Files updated on disk:')} ${bold(filesModifiedThisTurn.join(', '))}\r\n`);
      }

      // Turn Footer
      this.io.write(`\r\n${dim(`[${result.model} · ${result.usage.totalTokens} tok · ${elapsed}ms · ${toolsCalled.length} tools]`)}\r\n`);
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
      this.io.write(`\r\n${red('✗ Error executing request:')} ${err instanceof Error ? err.message : String(err)}\r\n\r\n`);
    } finally {
      this.isProcessing = false;
    }
  }
}
