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
  /** Total tokens of the kept turns (prompt + response). */
  tokens: number;
}

/**
 * Keeps the newest turns that fit within `budgetTokens`, in original order.
 * The newest turn is always kept even if it alone exceeds the budget, so
 * recent context is never silently dropped.
 */
export function budgetConversationHistory(
  turns: ConversationTurn[],
  budgetTokens: number,
  options: HistoryBudgetOptions = {},
): HistoryBudgetResult {
  const kept: ConversationTurn[] = [];
  let tokens = 0;
  let dropped = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    let turn = turns[i]!;
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
      continue;
    }
    kept.unshift(turn);
    tokens += cost;
  }
  return { turns: kept, droppedCount: dropped, tokens };
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
