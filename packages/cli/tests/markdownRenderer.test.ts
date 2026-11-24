import { formatMarkdown, StreamMarkdown } from '../src/terminal/ansi.js';
import {
  ProgressiveTableStreamer,
  computeTableLayout,
} from '../src/terminal/markdown/table.js';
import { highlightCode } from '../src/terminal/markdown/code.js';
import { formatInline, stripAnsi, visibleWidth } from '../src/terminal/markdown/inline.js';

describe('Terminal Markdown Renderer Baseline (Phase 0 & Phase 6)', () => {
  it('formats basic headers with ANSI styling', () => {
    const output = formatMarkdown('# Hello World');
    expect(output).toContain('Hello World');
    expect(output).toContain('\x1b['); // contains ANSI escapes
  });

  it('formats code fences with borders', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const output = formatMarkdown(input);
    expect(output).toContain('typescript');
    expect(stripAnsi(output)).toContain('const x = 1;');
  });

  it('processes streaming markdown with StreamMarkdown', () => {
    const stream = new StreamMarkdown();
    const chunk1 = stream.process('# Title\n');
    const chunk2 = stream.process('Some **bold** text\n');
    const flushed = stream.flush();
    const combined = chunk1 + chunk2 + flushed;
    expect(combined).toContain('Title');
    expect(combined).toContain('bold');
  });

  describe('Two-Phase Progressive Table Streaming', () => {
    it('buffers header, delimiter and first row, then emits on second row', () => {
      const tableStreamer = new ProgressiveTableStreamer(80);

      const r0 = tableStreamer.addRow('| Col A | Col B |');
      expect(r0).toBe('');

      const r1 = tableStreamer.addRow('| ----- | ----- |');
      expect(r1).toBe('');

      const r2 = tableStreamer.addRow('| Alpha | Beta  |');
      expect(r2).toBe(''); // Still buffering (only 1 data row)

      const r3 = tableStreamer.addRow('| Gamma | Delta |');
      // 2 data rows reached -> Phase 2 triggered!
      expect(r3).toContain('┌');
      expect(r3).toContain('Col A');
      expect(r3).toContain('Col B');
      expect(r3).toContain('├');
      expect(r3).toContain('Alpha');
      expect(r3).toContain('Gamma');

      // Subsequent rows stream line-by-line immediately (truncated if exceeding column width)
      const r4 = tableStreamer.addRow('| Epsilon | Zeta |');
      expect(r4).toContain('Epsi…');
      expect(r4).toContain('Zeta');
      expect(r4).toContain('│');

      // Flush emits bottom border
      const r5 = tableStreamer.flush();
      expect(r5).toContain('└');
      expect(r5).toContain('┘');
    });

    it('truncates oversized cells in subsequent rows with ellipsis …', () => {
      const tableStreamer = new ProgressiveTableStreamer(80);
      tableStreamer.addRow('| Short | Desc |');
      tableStreamer.addRow('| ----- | ---- |');
      tableStreamer.addRow('| a     | b    |');
      tableStreamer.addRow('| c     | d    |'); // Phase 2 triggered

      // Feed row with huge cell exceeding column width
      const r4 = tableStreamer.addRow('| huge_cell_value_that_exceeds_normal_bounds | normal |');
      expect(r4).toContain('…');
      tableStreamer.flush();
    });

    it('flushes cleanly if table ends before 2 data rows', () => {
      const tableStreamer = new ProgressiveTableStreamer(80);
      tableStreamer.addRow('| Head1 | Head2 |');
      tableStreamer.addRow('| ----- | ----- |');
      tableStreamer.addRow('| Only1 | Val2  |');

      const flushed = tableStreamer.flush();
      expect(flushed).toContain('┌');
      expect(flushed).toContain('Head1');
      expect(flushed).toContain('Only1');
      expect(flushed).toContain('└');
    });

    it('scales columns down to fit within narrow terminal width', () => {
      const layout = computeTableLayout(
        ['VeryLongColumnHeaderOne', 'VeryLongColumnHeaderTwo'],
        [['Data1', 'Data2']],
        ['left', 'left'],
        40, // narrow terminal width
      );

      expect(layout.totalWidth).toBeLessThanOrEqual(40);
    });

    it('streams tables end-to-end through StreamMarkdown', () => {
      const sm = new StreamMarkdown({ columns: 80 });
      let output = '';
      output += sm.process('| Name | Score |\n');
      output += sm.process('| ---- | ----- |\n');
      output += sm.process('| Alice | 100 |\n');
      output += sm.process('| Bob   | 95  |\n');
      output += sm.process('| Carol | 88  |\n');
      output += sm.flush();

      expect(output).toContain('Name');
      expect(output).toContain('Score');
      expect(output).toContain('Alice');
      expect(output).toContain('Carol');
      expect(output).toContain('┌');
      expect(output).toContain('└');
    });
  });

  describe('Syntax Highlighting & Inline Extensions', () => {
    it('highlights TypeScript code tokens', () => {
      const code = 'const count: number = 42;';
      const highlighted = highlightCode(code, 'typescript');
      expect(highlighted).toContain('\x1b[');
      expect(stripAnsi(highlighted)).toBe(code);
    });

    it('highlights Python code tokens and comments', () => {
      const code = 'def foo():\n  # comment\n  return True';
      const highlighted = highlightCode(code, 'python');
      expect(highlighted).toContain('\x1b[');
      expect(stripAnsi(highlighted)).toBe(code);
    });

    it('highlights diff additions and deletions', () => {
      const diff = '+ added line\n- removed line';
      const highlighted = highlightCode(diff, 'diff');
      expect(highlighted).toContain('\x1b[32m+ added line');
      expect(highlighted).toContain('\x1b[31m- removed line');
    });

    it('formats strikethrough, inline code and hyperlinks', () => {
      const text = 'This is ~~deleted~~ and `code` and [link](https://example.com)';
      const formatted = formatInline(text, { hyperlinks: true });
      expect(formatted).toContain('\x1b[9mdeleted');
      expect(formatted).toContain('\x1b[33mcode');
      expect(formatted).toContain('\x1b]8;;https://example.com\x1b\\');
    });

    it('calculates visible width correctly for CJK fullwidth characters and emoji', () => {
      expect(visibleWidth('hello')).toBe(5);
      expect(visibleWidth('你好')).toBe(4);
      expect(visibleWidth('🚀')).toBe(2);
      expect(visibleWidth('\x1b[32mhello\x1b[0m')).toBe(5);
    });

    it('streams fenced code blocks without leaking the opening fence', () => {
      const sm = new StreamMarkdown({ columns: 80 });
      const out =
        sm.process('```ts\n') +
        sm.process('const x = 1;\n') +
        sm.process('```\n') +
        sm.flush();
      expect(stripAnsi(out)).not.toContain('```ts');
      expect(stripAnsi(out)).toContain('const x = 1;');
      expect(stripAnsi(out)).toContain('ts');
    });

    it('streams headings, bullets, blockquotes, bold, and links without artifact leaks', () => {
      const sm = new StreamMarkdown({ hyperlinks: false });

      // Heading: # Title
      const hOut = sm.process('# ') + sm.process('Header Title\n') + sm.flush();
      expect(stripAnsi(hOut)).not.toContain('# Header');
      expect(stripAnsi(hOut)).toContain('Header Title');

      // Bullet: - one
      const bOut = sm.process('- ') + sm.process('one item\n') + sm.flush();
      expect(stripAnsi(bOut)).not.toContain('- •');
      expect(stripAnsi(bOut)).toContain('• one item');

      // Task list: - [ ] unchecked
      const tOut = sm.process('- [ ] ') + sm.process('task item\n') + sm.flush();
      expect(stripAnsi(tOut)).toContain('☐ task item');

      // Blockquote: > quote
      const qOut = sm.process('> ') + sm.process('wise quote\n') + sm.flush();
      expect(stripAnsi(qOut)).toContain('│ wise quote');

      // Bold: **bold text**
      const boldOut = sm.process('**bold') + sm.process(' text**') + sm.flush();
      expect(boldOut).toContain('\x1b[1mbold text\x1b[0m');

      // Links: [Mugil](https://mugil.ai)
      const linkOut = sm.process('[Mugil](') + sm.process('https://mugil.ai)') + sm.flush();
      expect(linkOut).toContain('Mugil');
      expect(linkOut).toContain('https://mugil.ai');
    });
  });
});
