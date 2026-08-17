import {
  budgetConversationHistory,
  renderConversationForSummary,
  type ConversationTurn,
} from '../src/history.js';

function turn(prompt: string, response: string): ConversationTurn {
  return { prompt, response };
}

describe('budgetConversationHistory', () => {
  it('keeps all turns when they fit the budget, in order', () => {
    const turns = [turn('a', '1'), turn('b', '2'), turn('c', '3')];
    const result = budgetConversationHistory(turns, 10_000);
    expect(result.turns.map((t) => t.prompt)).toEqual(['a', 'b', 'c']);
    expect(result.droppedCount).toBe(0);
  });

  it('keeps the newest turns that fit and drops the oldest', () => {
    // Each turn is ~35 tokens; a 40-token budget fits only the newest.
    const turns = Array.from({ length: 5 }, (_, i) =>
      turn(`prompt-${i} ${'x'.repeat(60)}`, `response-${i} ${'y'.repeat(60)}`),
    );
    const result = budgetConversationHistory(turns, 40);
    expect(result.turns.length).toBeGreaterThan(0);
    expect(result.turns.length).toBeLessThan(5);
    // Oldest kept turn is the newest-overflow boundary — order preserved.
    const prompts = result.turns.map((t) => t.prompt);
    expect(prompts).toEqual([...prompts].sort());
    // The newest turn is always present.
    expect(prompts[prompts.length - 1]).toBe(turns[4]!.prompt);
    expect(result.droppedCount).toBe(5 - result.turns.length);
  });

  it('never drops the newest turn even when it alone exceeds the budget', () => {
    const turns = [turn('tiny', 'x'), turn('huge', 'y'.repeat(10_000))];
    const result = budgetConversationHistory(turns, 100);
    expect(result.turns.map((t) => t.prompt)).toEqual(['huge']);
    expect(result.droppedCount).toBe(1);
  });

  it('returns empty for no turns', () => {
    const result = budgetConversationHistory([], 1000);
    expect(result.turns).toEqual([]);
    expect(result.droppedCount).toBe(0);
    expect(result.tokens).toBe(0);
  });
});

describe('renderConversationForSummary', () => {
  it('renders turns as User/Assistant blocks', () => {
    const text = renderConversationForSummary([turn('fix the bug', 'fixed it')], 10_000);
    expect(text).toContain('User: fix the bug');
    expect(text).toContain('Assistant: fixed it');
  });

  it('caps the rendered length', () => {
    const turns = Array.from({ length: 100 }, (_, i) => turn(`prompt ${i}`, `response ${i}`));
    const text = renderConversationForSummary(turns, 500);
    expect(text.length).toBeLessThan(2000);
    expect(text).toContain('earlier turns omitted');
  });
});
