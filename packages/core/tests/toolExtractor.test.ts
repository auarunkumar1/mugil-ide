import { extractTextualToolCalls, StreamToolFilter } from '../src/modules/handoff/toolExtractor.js';

describe('extractTextualToolCalls', () => {
  it('returns empty toolCalls if text has no tool invocation', () => {
    const text = 'Hello, how can I help you today?';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toEqual([]);
    expect(result.cleanContent).toBe(text);
  });

  it('extracts tool call from ```xml code block (llama.cpp Qwen2.5 output)', () => {
    const text = '```xml\n{"name": "read_file", "arguments": {"path": "foo.txt"}}\n```';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ path: 'foo.txt' });
    expect(result.cleanContent).toBe('');
  });

  it('extracts tool call from ```json code block (user observed todoread output)', () => {
    const text = "To review the pending points in the todo files, I'll call todoread:\n```json\n{\"name\": \"todoread\"}\n```";
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('todoread');
    expect(result.toolCalls[0].arguments).toBe('{}');
    expect(result.cleanContent).toBe("To review the pending points in the todo files, I'll call todoread:");
  });

  it('extracts tool call from <tool_call> tags (ChatML native)', () => {
    const text = 'Let me inspect that file.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "src/index.ts"}}\n</tool_call>';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ path: 'src/index.ts' });
    expect(result.cleanContent).toBe('Let me inspect that file.');
  });

  it('extracts tool call from [TOOL_CALLS] bracket format (Hermes / Mistral)', () => {
    const text = '[TOOL_CALLS] [{"name": "run_command", "arguments": {"command": "npm test"}}]';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('run_command');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ command: 'npm test' });
  });

  it('handles parameters or input instead of arguments', () => {
    const text = '```json\n{"name": "grep_search", "parameters": {"query": "TODO"}}\n```';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('grep_search');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ query: 'TODO' });
  });

  it('extracts nested bare JSON tool call and cleans content', () => {
    const text = '{"name": "todowrite", "arguments": {"todos": [{"content": "Fix placeholder", "status": "pending"}]}}';
    const result = extractTextualToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('todowrite');
    expect(result.cleanContent).toBe('');
  });
});

describe('StreamToolFilter', () => {
  it('passes normal text chunks incrementally to onDelta', () => {
    const filter = new StreamToolFilter();
    const emitted: string[] = [];
    filter.process('Hello ', (t) => emitted.push(t));
    filter.process('world!', (t) => emitted.push(t));
    filter.flush((t) => emitted.push(t));
    expect(emitted.join('')).toBe('Hello world!');
  });

  it('suppresses tool call inside ```json code block from streaming', () => {
    const filter = new StreamToolFilter();
    const emitted: string[] = [];
    const chunks = ['```json\n', '{"name": "todoread", ', '"arguments": {}}\n', '```'];
    for (const chunk of chunks) {
      filter.process(chunk, (t) => emitted.push(t));
    }
    filter.flush((t) => emitted.push(t));
    expect(emitted.join('')).toBe('');
  });

  it('suppresses <tool_call> tags from streaming', () => {
    const filter = new StreamToolFilter();
    const emitted: string[] = [];
    const chunks = ['<tool_call>\n', '{"name": "read_file", "arguments": {"path": "a.txt"}}\n', '</tool_call>'];
    for (const chunk of chunks) {
      filter.process(chunk, (t) => emitted.push(t));
    }
    filter.flush((t) => emitted.push(t));
    expect(emitted.join('')).toBe('');
  });

  it('delivers normal code blocks to onDelta', () => {
    const filter = new StreamToolFilter();
    const emitted: string[] = [];
    const chunks = ['```typescript\n', 'const a = 1;\n', 'console.log(a);\n', '```'];
    for (const chunk of chunks) {
      filter.process(chunk, (t) => emitted.push(t));
    }
    filter.flush((t) => emitted.push(t));
    expect(emitted.join('')).toContain('const a = 1;');
  });

  it('preserves prose preceding a tool call while suppressing the tool call itself', () => {
    const filter = new StreamToolFilter();
    const emitted: string[] = [];
    filter.process('Checking your tasks now...\n', (t) => emitted.push(t));
    filter.process('```json\n{"name": "todoread", "arguments": {}}\n```', (t) => emitted.push(t));
    filter.flush((t) => emitted.push(t));
    expect(emitted.join('').trim()).toBe('Checking your tasks now...');
  });
});
