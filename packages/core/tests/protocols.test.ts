import {
  ChatCompletionsAdapter,
  MessagesAdapter,
  ResponsesAdapter,
} from '../src/modules/handoff/protocols/index.js';
import type { ChatMessage } from '../src/types.js';

describe('Native Protocol Adapters & Reasoning Continuity (Phase 3)', () => {
  describe('ChatCompletionsAdapter', () => {
    const adapter = new ChatCompletionsAdapter();

    it('builds body with model, messages, tools, and reasoning_effort', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is 2+2?' },
        {
          role: 'assistant',
          content: '',
          reasoning: 'The user is asking basic arithmetic.',
          toolCalls: [{ id: 'call_1', name: 'calc', arguments: '{"expr":"2+2"}' }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '4' },
      ];

      const body = adapter.buildRequestBody(messages, {
        model: 'deepseek-v4.1-flash',
        thinkingLevel: 'medium',
      });

      expect(body.model).toBe('deepseek-v4.1-flash');
      expect(body.reasoning_effort).toBe('medium');
      expect(Array.isArray(body.messages)).toBe(true);
      const assistantMsg = (body.messages as any[])[1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.reasoning_content).toBe('The user is asking basic arithmetic.');
      expect(assistantMsg.tool_calls).toHaveLength(1);
    });

    it('parses response and extracts reasoning and tool calls', () => {
      const raw = {
        choices: [
          {
            message: {
              content: 'The answer is 4.',
              reasoning_content: 'Calculated 2+2=4.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 10,
          total_tokens: 25,
          completion_tokens_details: { reasoning_tokens: 6 },
        },
      };

      const result = adapter.parseResponse(raw, 'deepseek-v4.1-flash', 'opencode');
      expect(result.content).toBe('The answer is 4.');
      expect(result.thinking).toBe('Calculated 2+2=4.');
      expect(result.usage.reasoningTokens).toBe(6);
    });
  });

  describe('MessagesAdapter (Anthropic / Qwen format)', () => {
    const adapter = new MessagesAdapter();

    it('builds body with system block, messages, and thinking budget tokens', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are an expert coder.' },
        { role: 'user', content: 'Write hello world.' },
        {
          role: 'assistant',
          content: 'Here is the code:',
          reasoning: 'Planning a simple TS snippet.',
          toolCalls: [{ id: 'call_2', name: 'write_file', arguments: '{}' }],
        },
      ];

      const body = adapter.buildRequestBody(messages, {
        model: 'claude-haiku-5-5',
        thinkingLevel: 'high',
      });

      expect(body.model).toBe('claude-haiku-5-5');
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
      expect(Array.isArray(body.system)).toBe(true);
      expect((body.system as any[])[0].text).toBe('You are an expert coder.');

      const chatMessages = body.messages as any[];
      expect(chatMessages).toHaveLength(2); // system moved to top-level
      const assistantMsg = chatMessages[1];
      expect(assistantMsg.role).toBe('assistant');
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      expect(assistantMsg.content.some((b: any) => b.type === 'thinking' && b.thinking === 'Planning a simple TS snippet.')).toBe(true);
    });

    it('parses Anthropic response with thinking blocks and cache creation tokens', () => {
      const raw = {
        model: 'claude-haiku-5-5',
        content: [
          { type: 'thinking', thinking: 'Analyzing request...' },
          { type: 'text', text: 'Hello, World!' },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 15,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
        stop_reason: 'end_turn',
      };

      const result = adapter.parseResponse(raw, 'claude-haiku-5-5', 'opencode');
      expect(result.content).toBe('Hello, World!');
      expect(result.thinking).toBe('Analyzing request...');
      expect(result.usage.cachedTokens).toBe(10);
      expect(result.usage.cacheWriteTokens).toBe(5);
    });
  });

  describe('ResponsesAdapter (OpenAI Responses API)', () => {
    const adapter = new ResponsesAdapter();

    it('builds body with input array, instructions, and reasoning effort', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Ping' },
      ];

      const body = adapter.buildRequestBody(messages, {
        model: 'gpt-5-preview',
        thinkingLevel: 'low',
      });

      expect(body.model).toBe('gpt-5-preview');
      expect(body.instructions).toBe('Be concise.');
      expect(body.reasoning).toEqual({ effort: 'low' });
      expect(Array.isArray(body.input)).toBe(true);
      expect((body.input as any[])[0]).toEqual({ role: 'user', content: 'Ping' });
    });

    it('parses native output_text content and OpenCode usage metadata', () => {
      const raw = {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Pong!' }],
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 4,
          total_tokens: 12,
          input_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 },
          output_tokens_details: { reasoning_tokens: 2 },
          cost: 0,
          opencode: {
            billing_source: 'go',
            list_cost: 0.00001,
            allowance: 0.00002,
          },
        },
      };
      const result = adapter.parseResponse(raw, 'gpt-5-preview', 'opencode');
      expect(result.content).toBe('Pong!');
      expect(result.usage.cachedTokens).toBe(3);
      expect(result.usage.cacheWriteTokens).toBe(1);
      expect(result.usage.reasoningTokens).toBe(2);
      expect(result.usage.billingSource).toBe('go');
      expect(result.usage.listCost).toBeCloseTo(0.00001);
      expect(result.usage.allowance?.used).toBeCloseTo(0.00002);
    });

    it('parses Responses API output and usage', () => {
      const raw = {
        output_text: 'Pong!',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'Quick reply.' },
              { type: 'text', text: 'Pong!' },
            ],
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 4,
          total_tokens: 12,
        },
      };

      const result = adapter.parseResponse(raw, 'gpt-5-preview', 'opencode');
      expect(result.content).toBe('Pong!');
      expect(result.thinking).toBe('Quick reply.');
      expect(result.usage.totalTokens).toBe(12);
    });
  });
});
