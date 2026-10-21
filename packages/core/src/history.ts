/**
 * Token-aware conversation history
 * =================================
 * Trims multi-turn history by token budget instead of a blind "last N turns",
 * following the established coding-agent practice (OpenCode's context
 * management): keep the newest turns that fit the budget, oldest-first, so
 * the model always has the most recent context and older noise is dropped.
 *
 * Credit: context-trimming pattern from OpenCode — https://github.com/sst/opencode
 * See ATTRIBUTIONS.md at the repository root for the full credit list.
 */
import { countTokens } from './token/tokenizer.js';
import { cavemanStrategy } from './modules/caveman/index.js';
import { rtkStrategy } from './modules/rtk/index.js';

export interface ConversationTurn {
  prompt: string;
  response: string;
}

export interface HistoryBudgetOptions {
  /** When true, compresses older turns (all except the newest) with Caveman/RTK before budgeting. */
  compactOlderTurns?: boolean;
}

export interface HistoryBudgetResult {
  /** Turns to keep, oldest-first. */
  turns: ConversationTurn[];
  /** Turns dropped because the budget ran out (newest-first walk). */
  droppedCount: number;
  /** Evicted turns that fell out of the active budget window. */
  evictedTurns: ConversationTurn[];
  /** Total tokens of the kept turns (prompt + response). */
  tokens: number;
  /** Total tokens of the evicted turns that were dropped. */
  evictedTokens: number;
  /** Dense background summary of evicted turns if any dropped. */
  compactedSummary?: string;
}

export const DEFAULT_HISTORY_BUDGET = 16_000;
export const DEFAULT_MAX_HISTORY_TURNS = 50;

export function getHistoryBudget(env: NodeJS.ProcessEnv = process.env): number {
  const custom = env.MUGIL_IDE_TOKEN_LIMIT || env.MUGIL_IDE_HISTORY_BUDGET;
  if (custom) {
    const parsed = Number(custom);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_HISTORY_BUDGET;
}

export function getMaxHistoryTurns(env: NodeJS.ProcessEnv = process.env): number {
  const custom = env.MUGIL_IDE_MAX_TURNS;
  if (custom) {
    const parsed = Number(custom);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_MAX_HISTORY_TURNS;
}

/** Creates a dense, structured digest of evicted conversation turns without an extra LLM call. */
export function buildAutonomousCompaction(evictedTurns: ConversationTurn[]): string {
  if (evictedTurns.length === 0) return '';
  const lines: string[] = ['[Autonomous context compaction — earlier turns summarized]:'];
  for (let i = 0; i < evictedTurns.length; i++) {
    const t = evictedTurns[i]!;
    const userDense = cavemanStrategy(t.prompt).text.replace(/\s+/g, ' ').slice(0, 150);
    const assistantDense = rtkStrategy(t.response).text.replace(/\s+/g, ' ').slice(0, 200);
    lines.push(`• Turn ${i + 1}: User: "${userDense}" → Outcome: "${assistantDense}"`);
  }
  return lines.join('\n');
}

/**
 * Keeps the newest turns that fit within `budgetTokens`, in original order.
 * The newest turn is always kept even if it alone exceeds the budget, so
 * recent context is never silently dropped. Evicted turns are returned
 * along with a dense autonomous compaction summary.
 */
export function budgetConversationHistory(
  turns: ConversationTurn[],
  budgetTokens: number = DEFAULT_HISTORY_BUDGET,
  options: HistoryBudgetOptions = {},
): HistoryBudgetResult {
  const kept: ConversationTurn[] = [];
  const evicted: ConversationTurn[] = [];
  let tokens = 0;
  let dropped = 0;
  let evictedTokens = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const rawTurn = turns[i]!;
    let turn = rawTurn;
    // Compact older turns to fit ~25-35% more context in the window
    if (options.compactOlderTurns && i < turns.length - 1) {
      turn = {
        prompt: cavemanStrategy(turn.prompt).text,
        response: rtkStrategy(turn.response).text,
      };
    }
    const cost = countTokens(turn.prompt) + countTokens(turn.response);
    if (tokens + cost > budgetTokens && kept.length > 0) {
      dropped += 1;
      evicted.unshift(rawTurn);
      evictedTokens += (turn === rawTurn) ? cost : countTokens(rawTurn.prompt) + countTokens(rawTurn.response);
      continue;
    }
    kept.unshift(turn);
    tokens += cost;
  }
  const compactedSummary = evicted.length > 0 ? buildAutonomousCompaction(evicted) : undefined;
  return { turns: kept, droppedCount: dropped, evictedTurns: evicted, tokens, evictedTokens, compactedSummary };
}

/** Renders turns as plain text for the summarizer (capped in length). */
export function renderConversationForSummary(turns: ConversationTurn[], maxChars = 40_000): string {
  let out = '';
  for (const turn of turns) {
    const block = `User: ${turn.prompt}\nAssistant: ${turn.response}\n\n`;
    if (out.length + block.length > maxChars) {
      out += `… (${turns.length} earlier turns omitted)\n`;
      break;
    }
    out += block;
  }
  return out;
}
